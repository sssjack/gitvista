import { BrowserWindow, Menu, Tray, screen } from 'electron';
import path from 'node:path';
import type { AppSettings, DesktopCommand, DesktopState, GitLogResult, MiniFrame } from '../shared/types';
import { translate } from '../shared/messages';

type Rectangle = Electron.Rectangle;
export const COMPACT_WIDTH = 128;
export const EXPANDED_WIDTH = 360;
export const HEIGHT = 40;
export const EDGE_PEEK = 6;
export function fitBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) };
}
export function dockEdge(bounds: Rectangle, area: Rectangle): DesktopState['edge'] {
  const distances = { left: Math.abs(bounds.x - area.x), right: Math.abs(area.x + area.width - bounds.x - bounds.width), top: Math.abs(bounds.y - area.y), bottom: Math.abs(area.y + area.height - bounds.y - bounds.height) };
  const closest = (Object.keys(distances) as Exclude<DesktopState['edge'], null>[]).sort((a, b) => distances[a] - distances[b])[0];
  return distances[closest] <= 28 ? closest : null;
}
export function collapsedBounds(bounds: Rectangle, area: Rectangle, edge: DesktopState['edge']): Rectangle {
  const fit = fitBounds(bounds, area);
  if (edge === 'left') return { ...fit, x: area.x, width: EDGE_PEEK };
  if (edge === 'right') return { ...fit, x: area.x + area.width - EDGE_PEEK, width: EDGE_PEEK };
  if (edge === 'top') return { ...fit, y: area.y, height: EDGE_PEEK };
  if (edge === 'bottom') return { ...fit, y: area.y + area.height - EDGE_PEEK, height: EDGE_PEEK };
  return fit;
}
export function snapBounds(bounds: Rectangle, area: Rectangle, edge: DesktopState['edge']): Rectangle {
  const fit = fitBounds(bounds, area);
  if (edge === 'left') fit.x = area.x;
  if (edge === 'right') fit.x = area.x + area.width - fit.width;
  if (edge === 'top') fit.y = area.y;
  if (edge === 'bottom') fit.y = area.y + area.height - fit.height;
  return fit;
}
// Match the CSS capsule for mouse pass-through without clipping its antialiased pixels.
export function capsuleContains(bounds: Rectangle, point: { x: number; y: number }): boolean {
  if (point.x < bounds.x || point.y < bounds.y || point.x >= bounds.x + bounds.width || point.y >= bounds.y + bounds.height) return false;
  const radius = Math.min(bounds.width, bounds.height) / 2;
  const x = point.x - bounds.x, y = point.y - bounds.y;
  const dx = Math.max(0, radius - x, x - (bounds.width - radius));
  const dy = Math.max(0, radius - y, y - (bounds.height - radius));
  return dx * dx + dy * dy <= radius * radius;
}
interface Dependencies {
  settings: () => AppSettings;
  busy: () => boolean;
  log: (repo: string) => Promise<GitLogResult>;
  pull: (repo: string) => Promise<unknown>;
  quit: () => void;
}
export class DesktopCompanion {
  private tray: Tray;
  private mode: DesktopState['mode'] = 'main';
  private collapsed = false;
  private expanded = false;
  private direction: DesktopState['direction'] = 'left';
  private edge: DesktopState['edge'] = null;
  private repo = '';
  private commits: DesktopState['commits'] = [];
  private error = '';
  private working = false;
  private refreshGeneration = 0;
  private ignoringMouse = false;
  private compactBounds: Rectangle | null = null;
  private visualBounds: Rectangle | null = null;
  private frame: MiniFrame = { x: 0, y: 0, width: COMPACT_WIDTH, height: HEIGHT };
  private animation: NodeJS.Timeout | null = null;
  private dragging = false;
  private settlingUntil = 0;
  private previousBounds = '';
  private movedAt = 0;
  private hoveredAt = Date.now();
  private enteredAt = 0;
  private ticker: NodeJS.Timeout;
  private refresher: NodeJS.Timeout;
  constructor(private mainWindow: BrowserWindow, private window: BrowserWindow, private dependencies: Dependencies) {
    this.tray = new Tray(path.join(__dirname, '../assets/icon.ico'));
    this.tray.on('click', () => this.restore());
    this.tray.on('double-click', () => this.restore());
    this.tray.on('right-click', () => this.publish());
    this.mainWindow.on('minimize', this.hide);
    this.window.on('will-move', this.beginMove);
    this.window.on('moved', this.endMove);
    this.ticker = setInterval(() => this.tick(), 50);
    this.refresher = setInterval(() => { if (!this.dependencies.busy()) void this.refresh(); }, 30_000);
    screen.on('display-metrics-changed', this.reposition);
    screen.on('display-removed', this.reposition);
    this.publish();
    void this.refresh();
  }
  state(): DesktopState {
    const settings = this.dependencies.settings();
    return { mode: this.mode, collapsed: this.collapsed, expanded: this.expanded, direction: this.direction, edge: this.edge, frame: this.frame, repo: settings.lastRepo || '', commits: settings.lastRepo === this.repo ? this.commits : [], busy: this.working || this.dependencies.busy(), error: this.error, language: settings.language, theme: settings.theme };
  }
  private t = (text: string) => translate(this.dependencies.settings().language, text);
  publish(): void {
    if (this.window.isDestroyed() || this.tray.isDestroyed()) return;
    const state = this.state();
    const repoName = state.repo ? path.basename(state.repo) : this.t('未打开仓库');
    this.tray.setToolTip(`GitVista · ${repoName}${this.commits[0] ? `\n${this.commits[0].short} ${this.commits[0].subject}` : ''}`.slice(0, 120));
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: this.t('打开主窗口'), click: () => this.restore() },
      { label: this.t('迷你横条'), click: () => this.mini() },
      { type: 'separator' },
      { label: repoName, enabled: false },
      { label: this.t('拉取更新'), enabled: !!state.repo && !state.busy, click: () => { void this.command('pull'); } },
      { label: this.t('刷新'), enabled: !!state.repo && !state.busy, click: () => { void this.command('refresh'); } },
      { label: this.t('最新提交'), submenu: this.commits.length ? this.commits.map(commit => ({ label: `${commit.short} ${commit.subject}`.replace(/&/g, '&&').slice(0, 150), click: () => { void this.command('latest'); } })) : [{ label: this.t('没有记录'), enabled: false }] },
      ...(this.error ? [{ label: this.error.slice(0, 130), enabled: false }] : []),
      { type: 'separator' },
      { label: this.t('退出'), click: this.dependencies.quit },
    ]));
    this.window.webContents.send('gv:desktop:state', state);
    if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('gv:desktop:state', state);
  }
  async refresh(): Promise<void> {
    const repo = this.dependencies.settings().lastRepo || '';
    const generation = ++this.refreshGeneration;
    if (repo !== this.repo) { this.repo = repo; this.commits = []; this.error = ''; this.publish(); }
    if (!repo) { this.commits = []; this.publish(); return; }
    try {
      const result = await this.dependencies.log(repo);
      if (generation !== this.refreshGeneration || repo !== this.dependencies.settings().lastRepo) return;
      this.commits = result.commits;
    } catch (error) {
      if (generation === this.refreshGeneration) this.error = error instanceof Error ? error.message : String(error);
    }
    this.publish();
  }
  async command(command: DesktopCommand): Promise<void> {
    if (command === 'mini' || command === 'latest') { this.mini(); if (command === 'latest') this.expand(); await this.refresh(); return; }
    if (command === 'expand') { this.expand(); return; }
    if (command === 'restore') { this.restore(); return; }
    if (command === 'tray') { this.hide(); return; }
    if (command === 'quit') { this.dependencies.quit(); return; }
    if (command !== 'pull' && command !== 'refresh') throw new Error('Unknown desktop command.');
    const repo = this.dependencies.settings().lastRepo;
    if (!repo || this.working || this.dependencies.busy()) return;
    this.working = true; this.error = ''; this.publish();
    try {
      if (command === 'pull') await this.dependencies.pull(repo);
      await this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      if (!this.window.isVisible()) this.tray.displayBalloon({ title: `GitVista · ${this.t('拉取更新')}`, content: this.error.slice(0, 240), iconType: 'error' });
    } finally {
      this.working = false; this.publish();
      this.mainWindow.webContents.send('gv:repository:refresh');
    }
  }
  mini(): void {
    if (this.mode === 'main') {
      this.mode = 'mini';
      const area = screen.getDisplayMatching(this.mainWindow.getNormalBounds()).workArea;
      this.compactBounds = fitBounds(this.compactBounds || { x: area.x + area.width - COMPACT_WIDTH - 48, y: area.y + area.height - HEIGHT - 48, width: COMPACT_WIDTH, height: HEIGHT }, area);
      this.collapsed = false; this.expanded = false; this.edge = dockEdge(this.compactBounds, area);
      this.hoveredAt = Date.now(); this.enteredAt = 0;
      this.chooseDirection(area);
      this.applyFrame(this.compactBounds);
      this.settlingUntil = Date.now() + 150;
    }
    this.mainWindow.hide();
    this.window.showInactive(); this.publish();
  }
  restore(): void {
    if (this.mainWindow.isDestroyed()) return;
    if (this.mode === 'mini') {
      this.stopAnimation();
      this.mode = 'main'; this.collapsed = false; this.expanded = false; this.edge = null; this.dragging = false;
      this.window.hide();
    }
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show(); this.mainWindow.focus(); this.publish();
    this.mainWindow.webContents.send('gv:repository:refresh');
  }
  hide = (): void => {
    this.stopAnimation();
    if (this.mode === 'mini' && this.compactBounds) {
      this.expanded = false; this.collapsed = false;
      this.applyFrame(this.compactBounds); this.publish();
    }
    this.window.hide();
    this.mainWindow.hide();
  };
  private chooseDirection(area: Rectangle): void {
    if (!this.compactBounds) return;
    const extra = EXPANDED_WIDTH - COMPACT_WIDTH;
    this.direction = this.edge === 'left' || (this.edge !== 'right' && this.compactBounds.x - extra < area.x) ? 'right' : 'left';
  }
  private targetBounds(): Rectangle {
    const compact = this.compactBounds!;
    const area = screen.getDisplayMatching(compact).workArea;
    if (this.collapsed) return collapsedBounds(compact, area, this.edge);
    if (!this.expanded) return compact;
    return fitBounds({ ...compact, x: this.direction === 'left' ? compact.x - (EXPANDED_WIDTH - COMPACT_WIDTH) : compact.x, width: EXPANDED_WIDTH }, area);
  }
  private expand(): void {
    if (this.mode !== 'mini' || !this.compactBounds || this.dragging) return;
    this.collapsed = false; this.expanded = true; this.hoveredAt = Date.now();
    this.publish(); this.animateTo(this.targetBounds());
  }
  private stopAnimation(): void {
    if (this.animation) clearInterval(this.animation);
    this.animation = null;
  }
  private applyFrame(visual: Rectangle): void {
    this.visualBounds = visual;
    // Windows enforces a minimum native height even for frameless windows.
    // Keep a full-height transparent backing window; only CSS paints the capsule.
    const native = { ...visual, width: Math.max(32, visual.width), height: Math.max(HEIGHT, visual.height) };
    if (this.edge === 'right') native.x -= native.width - visual.width;
    if (this.edge === 'bottom') native.y -= native.height - visual.height;
    this.window.setBounds(native);
    this.frame = { x: visual.x - native.x, y: visual.y - native.y, width: visual.width, height: visual.height };
    this.window.webContents.send('gv:desktop:frame', this.frame);
    this.updateMousePassThrough();
    this.previousBounds = JSON.stringify(this.window.getBounds());
  }
  private updateMousePassThrough(): boolean {
    const inside = capsuleContains(this.visualBounds || this.window.getBounds(), screen.getCursorScreenPoint());
    const ignore = !inside && !this.dragging;
    if (ignore !== this.ignoringMouse) {
      this.ignoringMouse = ignore;
      this.window.setIgnoreMouseEvents(ignore, { forward: true });
    }
    return inside;
  }
  private animateTo(target: Rectangle, duration = 260): void {
    this.stopAnimation();
    const from = this.visualBounds || this.window.getBounds();
    const started = Date.now();
    const frame = () => {
      if (this.mode !== 'mini' || this.window.isDestroyed()) { this.stopAnimation(); return; }
      const progress = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const bounds = { ...target };
      for (const key of ['x', 'y', 'width', 'height'] as const) bounds[key] = Math.round(from[key] + (target[key] - from[key]) * eased);
      this.applyFrame(bounds);
      if (progress >= 1) { this.stopAnimation(); this.settlingUntil = Date.now() + 100; }
    };
    this.animation = setInterval(frame, 16);
    frame();
  }
  private beginMove = (): void => {
    if (this.mode !== 'mini') return;
    this.stopAnimation(); this.dragging = true;
  };
  private endMove = (): void => {
    if (this.mode !== 'mini' || !this.dragging) return;
    this.dragging = false; this.adoptPosition();
  };
  private adoptPosition(): void {
    const bounds = this.window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    this.visualBounds = bounds;
    this.edge = dockEdge(fitBounds(bounds, area), area);
    const snapped = snapBounds(bounds, area, this.edge);
    const x = this.edge === 'left' ? snapped.x : this.edge === 'right' || this.direction === 'left' ? snapped.x + snapped.width - COMPACT_WIDTH : snapped.x;
    this.compactBounds = snapBounds({ x, y: snapped.y, width: COMPACT_WIDTH, height: HEIGHT }, area, this.edge);
    this.collapsed = false; this.chooseDirection(area);
    this.hoveredAt = Date.now(); this.enteredAt = 0;
    this.publish(); this.animateTo(this.targetBounds(), 180);
  }
  private reposition = (): void => {
    if (this.mode !== 'mini' || !this.compactBounds) return;
    this.stopAnimation(); this.dragging = false;
    this.edge = null; this.collapsed = false; this.expanded = false;
    this.compactBounds = fitBounds(this.compactBounds, screen.getDisplayMatching(this.compactBounds).workArea);
    this.chooseDirection(screen.getDisplayMatching(this.compactBounds).workArea);
    this.applyFrame(this.compactBounds); this.settlingUntil = Date.now() + 150; this.publish();
  };
  private tick(): void {
    if (this.mode !== 'mini' || this.window.isDestroyed() || !this.window.isVisible() || this.animation || this.dragging) return;
    const bounds = this.window.getBounds(), now = Date.now();
    const key = JSON.stringify(bounds);
    if (now < this.settlingUntil) { this.previousBounds = key; return; }
    if (key !== this.previousBounds) { this.previousBounds = key; this.movedAt = now; }
    // Also handle window-manager moves that do not emit the manual-drag events.
    if (this.movedAt) {
      if (now - this.movedAt < 150) return;
      this.movedAt = 0; this.adoptPosition(); return;
    }
    const inside = this.updateMousePassThrough();
    if (inside) {
      this.hoveredAt = now;
      if (!this.enteredAt) this.enteredAt = now;
      if ((this.collapsed || !this.expanded) && now - this.enteredAt >= 120) this.expand();
    } else {
      this.enteredAt = 0;
      if (!this.collapsed && (this.expanded || this.edge) && now - this.hoveredAt > 450) {
        this.expanded = false; this.collapsed = !!this.edge;
        this.publish(); this.animateTo(this.targetBounds());
      }
    }
  }
  dispose(): void {
    clearInterval(this.ticker); clearInterval(this.refresher);
    this.stopAnimation();
    this.mainWindow.removeListener('minimize', this.hide);
    this.window.removeListener('will-move', this.beginMove);
    this.window.removeListener('moved', this.endMove);
    screen.removeListener('display-metrics-changed', this.reposition);
    screen.removeListener('display-removed', this.reposition);
    this.tray.destroy();
  }
}
