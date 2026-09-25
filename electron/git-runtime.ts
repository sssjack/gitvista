import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let bundled = '';
let preferBundled = false;

/**
 * 内置 MinGit 目录。开发态指向 vendor/mingit，打包后指向 resources/git。
 * 目录不存在（未执行 scripts/fetch-mingit.mjs）时静默跳过，不影响使用系统 Git。
 */
export function setBundledGit(directory: string) { bundled = directory; }

/**
 * 打包后的应用优先使用内置 Git，确保“装上就能用”，不受目标机器 PATH 影响。
 * 开发态保持系统 Git 优先，避免内置版本掩盖本机环境。
 */
export function setBundledGitPreferred(value: boolean) { preferBundled = value; }

function bundledCandidates(): string[] {
  if (!bundled) return [];
  // MinGit 解包后可能是 cmd/git.exe，也可能被压平到根目录，两种布局都探测。
  return [path.join(bundled, 'cmd', 'git.exe'), path.join(bundled, 'bin', 'git.exe'), path.join(bundled, 'git.exe')];
}

function systemCandidates(): string[] {
  const candidates: string[] = [];
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Git')]) {
    if (root) candidates.push(path.join(root, 'Git', 'cmd', 'git.exe'), path.join(root, 'cmd', 'git.exe'));
  }
  return candidates;
}

/**
 * 同步探测注册表。仅在异步探测全部失败后作为兜底调用，
 * 因为 execFileSync 会阻塞主进程，不能放进正常的解析路径里。
 */
function registryCandidates(): string[] {
  const candidates: string[] = [];
  for (const key of ['HKCU\\Software\\GitForWindows', 'HKLM\\Software\\GitForWindows', 'HKLM\\Software\\WOW6432Node\\GitForWindows']) {
    try {
      const result = execFileSync('reg.exe', ['query', key, '/v', 'InstallPath'], { windowsHide: true, timeout: 3000, encoding: 'utf8' });
      const match = /InstallPath\s+REG_SZ\s+(.+)/.exec(result);
      if (match) candidates.push(path.join(match[1].trim(), 'cmd', 'git.exe'));
    } catch { /* 该注册表项不存在。 */ }
  }
  return candidates;
}

/** 运行一次 git --version 判断候选路径是否可用；失败即视为不可用。 */
async function usable(candidate: string): Promise<boolean> {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile(candidate, ['--version'], { windowsHide: true, timeout: 4000, encoding: 'utf8' }, (error, stdout) => {
        if (error) reject(error); else resolve(String(stdout));
      });
    });
    return /^git version /.test(result);
  } catch { return false; }
}

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }

export async function resolveGit(value: string): Promise<string> {
  // 用户在设置中显式指定的绝对路径优先，尊重手动选择。
  if (value !== 'git') return value;

  const scan = async (candidates: string[]): Promise<string> => {
    for (const candidate of unique(candidates)) if (await usable(candidate)) return candidate;
    return '';
  };

  const bundledCandidatesList = bundledCandidates();
  if (preferBundled) {
    const fromBundled = await scan(bundledCandidatesList);
    if (fromBundled) return fromBundled;
  }

  let fromPath: string[] = [];
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('where.exe', ['git.exe'], { windowsHide: true, timeout: 3000, encoding: 'utf8' }, (error, out) => {
        if (error) reject(error); else resolve(String(out));
      });
    });
    fromPath = stdout.trim().split(/\r?\n/).map(line => line.trim());
  } catch { /* PATH 中没有 git。 */ }
  const fromSystem = await scan([...fromPath, ...systemCandidates(), ...registryCandidates()]);
  if (fromSystem) return fromSystem;

  if (!preferBundled) {
    const fallback = await scan(bundledCandidatesList);
    if (fallback) return fallback;
  }

  throw new Error(bundled && !existsSync(bundled)
    ? 'No usable Git was found. This build did not bundle Git; install Git for Windows, or choose git.exe in settings.'
    : '找不到可用的 Git，请修复应用安装或在设置中选择 Git 程序。');
}

export function gitEnvironment(executable: string): NodeJS.ProcessEnv {
  if (!path.isAbsolute(executable)) return process.env;
  // MinGit 的 git.exe 位于 cmd/，配套命令在 mingw64/bin 与 usr/bin，必须补进 PATH。
  const root = path.resolve(path.dirname(executable), '..');
  const bins = [path.dirname(executable), path.join(root, 'mingw64', 'bin'), path.join(root, 'usr', 'bin')];
  const env = { ...process.env };
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[key] = [...bins, env[key] || ''].join(path.delimiter);
  // 内置 Git 自带 CA 包与配置模板；显式指向可避免继承宿主机的错误路径。
  const templates = path.join(root, 'mingw64', 'share', 'git-core', 'templates');
  if (existsSync(templates) && !env.GIT_TEMPLATE_DIR) env.GIT_TEMPLATE_DIR = templates;
  return env;
}
