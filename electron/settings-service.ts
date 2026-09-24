import path from 'node:path';
import { DEFAULT_PREFERENCES } from '../shared/types';
import type { AppPreferences, AppSettings, AppTheme, RepoEntry } from '../shared/types';

export const APP_THEMES: AppTheme[] = ['dark', 'light', 'midnight', 'nord', 'forest', 'rose'];
const PULL_STRATEGIES = ['ff-only', 'merge', 'rebase'];
const DIFF_VIEWS = ['split', 'unified'];

export function normalizeGitPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || /[\0\r\n]/.test(value)) throw new Error('Git 路径格式不正确。');
  const candidate = value.trim() || 'git';
  if (candidate === 'git') return candidate;
  if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== 'git.exe') {
    throw new Error('请输入 git，或 git.exe 的完整绝对路径；不能附带命令参数。');
  }
  return path.normalize(candidate);
}

export function validatePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') throw new Error('设置内容不正确。');
  const source = value as Record<string, unknown>;
  if (!APP_THEMES.includes(source.theme as AppTheme)) throw new Error('不支持的主题。');
  if (!PULL_STRATEGIES.includes(source.pullStrategy as string)) throw new Error('不支持的默认拉取策略。');
  if (!DIFF_VIEWS.includes(source.diffView as string)) throw new Error('不支持的差异显示方式。');
  if (typeof source.codeFontSize !== 'number' || !Number.isInteger(source.codeFontSize) || source.codeFontSize < 10 || source.codeFontSize > 22) {
    throw new Error('代码字号必须是 10 到 22 之间的整数。');
  }
  if (typeof source.wordWrap !== 'boolean') throw new Error('自动换行设置不正确。');
  return {
    theme: source.theme as AppTheme, gitPath: normalizeGitPath(source.gitPath),
    pullStrategy: source.pullStrategy as AppPreferences['pullStrategy'], diffView: source.diffView as AppPreferences['diffView'],
    codeFontSize: source.codeFontSize, wordWrap: source.wordWrap,
  };
}

export function normalizeSettings(value: unknown): AppSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  let gitPath = DEFAULT_PREFERENCES.gitPath;
  try { if (source.gitPath !== undefined) gitPath = normalizeGitPath(source.gitPath); } catch { /* 旧配置非法时恢复系统 Git。 */ }
  const repos: RepoEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(source.repos)) for (const item of source.repos) {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !path.isAbsolute(item.path) || /[\0\r\n]/.test(item.path)) continue;
    const directory = path.normalize(item.path);
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push({ path: directory, name: typeof item.name === 'string' && item.name ? item.name : path.basename(directory), lastOpened: typeof item.lastOpened === 'string' ? item.lastOpened : '' });
    if (repos.length >= 30) break;
  }
  const selected = typeof source.lastRepo === 'string' ? repos.find(repo => {
    return process.platform === 'win32' ? repo.path.toLowerCase() === path.normalize(source.lastRepo as string).toLowerCase() : repo.path === path.normalize(source.lastRepo as string);
  })?.path : undefined;
  return {
    ...DEFAULT_PREFERENCES, gitPath, repos, lastRepo: selected,
    theme: APP_THEMES.includes(source.theme as AppTheme) ? source.theme as AppTheme : DEFAULT_PREFERENCES.theme,
    pullStrategy: PULL_STRATEGIES.includes(source.pullStrategy as string) ? source.pullStrategy as AppPreferences['pullStrategy'] : DEFAULT_PREFERENCES.pullStrategy,
    diffView: DIFF_VIEWS.includes(source.diffView as string) ? source.diffView as AppPreferences['diffView'] : DEFAULT_PREFERENCES.diffView,
    codeFontSize: typeof source.codeFontSize === 'number' && Number.isInteger(source.codeFontSize) && source.codeFontSize >= 10 && source.codeFontSize <= 22 ? source.codeFontSize : DEFAULT_PREFERENCES.codeFontSize,
    wordWrap: typeof source.wordWrap === 'boolean' ? source.wordWrap : DEFAULT_PREFERENCES.wordWrap,
  };
}
