import { app, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ResourceUsage } from '../shared/types';

export const CACHE_BUDGET = 128 * 1024 * 1024;
const CACHE_NAMES = ['Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];
const MARKER = 'gitvista-cache-cleanup.json';
let sampling: Promise<ResourceUsage> | undefined;
let cleaning: Promise<ResourceUsage> | undefined;

async function cacheFiles(root: string, name: string): Promise<{ bytes: number; directory: string }> {
  const directory = path.join(root, name);
  let bytes = 0;
  const pending = [directory];
  while (pending.length) {
    const target = pending.pop()!;
    let stat;
    try { stat = await fs.lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error('缓存目录包含链接，已保留。');
    if (!stat.isDirectory()) { bytes += stat.size; continue; }
    const entries = await fs.opendir(target);
    for await (const entry of entries) pending.push(path.join(target, entry.name));
  }
  return { bytes, directory };
}
async function cacheRoot(): Promise<string> {
  const root = path.resolve(app.getPath('userData'));
  await fs.mkdir(root, { recursive: true });
  const actual = await fs.realpath(root);
  if (actual.toLowerCase() !== root.toLowerCase()) throw new Error('缓存目录经过重定向，已保留。');
  return root;
}
async function markerExists(root: string): Promise<boolean> {
  const target = path.join(root, MARKER);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('缓存维护标记不是普通文件，已保留。');
    return JSON.parse(await fs.readFile(target, 'utf8')).owner === 'gitvista';
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; }
}
async function scheduleCleanup(root: string): Promise<void> {
  await markerExists(root); // Reject redirected markers before writing anything.
  const temporary = path.join(root, `${MARKER}.${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify({ owner: 'gitvista', created: Date.now() })); }
    finally { await handle.close(); }
    await fs.rename(temporary, path.join(root, MARKER));
  }
  finally { await fs.rm(temporary, { force: true }); }
}
/** Run before any application window is created; never remove settings or storage. */
export async function maintainRuntimeCache(): Promise<void> {
  const root = await cacheRoot();
  const items = await Promise.all(CACHE_NAMES.map(name => cacheFiles(root, name)));
  if (!(await markerExists(root)) && items.reduce((sum, item) => sum + item.bytes, 0) <= CACHE_BUDGET) return;
  let failed = false;
  for (const name of CACHE_NAMES) {
    try {
      const { directory } = await cacheFiles(root, name);
      if (path.dirname(directory) !== root || !CACHE_NAMES.includes(path.basename(directory))) throw new Error('无效的缓存路径。');
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch { failed = true; }
  }
  if (!failed) await fs.rm(path.join(root, MARKER), { force: true });
}
export function resourceUsage(): Promise<ResourceUsage> {
  if (sampling) return sampling;
  sampling = (async () => {
    const root = await cacheRoot();
    const [items, httpCacheBytes, settingsStat, pendingCacheCleanup] = await Promise.all([
      Promise.all(CACHE_NAMES.map(name => cacheFiles(root, name))), session.defaultSession.getCacheSize(),
      fs.stat(path.join(root, 'settings.json')).catch(() => null), markerExists(root),
    ]);
    const metrics = app.getAppMetrics();
    const cacheBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    // Defer native GPU cache deletion until the next launch; never unlink live files.
    if (cacheBytes > CACHE_BUDGET && !pendingCacheCleanup) await scheduleCleanup(root);
    return {
      cacheBytes, httpCacheBytes, cacheBudgetBytes: CACHE_BUDGET, settingsBytes: settingsStat?.size || 0,
      pendingCacheCleanup: pendingCacheCleanup || cacheBytes > CACHE_BUDGET,
      processes: metrics.length, workingSetBytes: metrics.reduce((sum, item) => sum + item.memory.workingSetSize * 1024, 0),
      privateBytes: metrics.reduce((sum, item) => sum + (item.memory.privateBytes || 0) * 1024, 0), sampledAt: new Date().toISOString(),
    };
  })().finally(() => { sampling = undefined; });
  return sampling;
}
export function clearRuntimeCache(): Promise<ResourceUsage> {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    const root = await cacheRoot();
    await session.defaultSession.clearCache();
    await session.defaultSession.clearCodeCaches({});
    await scheduleCleanup(root);
    if (sampling) await sampling;
    return resourceUsage();
  })().finally(() => { cleaning = undefined; });
  return cleaning;
}
