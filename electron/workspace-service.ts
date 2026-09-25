import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isUtf8 } from 'node:buffer';
import * as git from './git-service';
import type { WorkspaceDirectory, WorkspaceScan } from '../shared/types';

const SKIP = new Set(['.git', 'node_modules', '.idea', '.vscode', '.venv', 'venv', '__pycache__', '.gradle', 'target', 'dist', 'build', 'out', 'coverage', '$recycle.bin', 'system volume information']);
const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;

/** Filesystem browsing is scoped to the approved parent, never Git metadata or links. */
async function workspacePath(root: string, relative: unknown = ''): Promise<string> {
  const directory = await workspaceDirectory(root);
  if (key(directory) !== key(path.resolve(root))) throw new Error('工作区路径已变化，请重新打开。');
  if (typeof relative !== 'string' || relative.length > 4096 || /[\\:\0\r\n]/.test(relative)) throw new Error('无效的工作区相对路径。');
  const parts = relative ? relative.split('/') : [];
  if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part))) throw new Error('无效的工作区相对路径。');
  let current = directory;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('不能浏览符号链接或目录联接。');
    if (key(await fs.realpath(current)) !== key(current)) throw new Error('工作区路径已变化，请重新打开。');
  }
  return current;
}

export async function readWorkspaceDirectory(root: string, relative = ''): Promise<WorkspaceDirectory> {
  const directory = await workspacePath(root, relative);
  const result: WorkspaceDirectory = { entries: [], truncated: false };
  const handle = await fs.opendir(directory);
  for await (const entry of handle) {
    if (entry.name.toLowerCase() === '.git') continue;
    if (result.entries.length >= 10000) { result.truncated = true; break; }
    result.entries.push({ name: entry.name, path: relative ? `${relative}/${entry.name}` : entry.name, type: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file' });
  }
  result.entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
  return result;
}

export async function readWorkspaceFile(root: string, relative: string): Promise<string> {
  if (!relative) throw new Error('请选择文件。');
  const absolute = await workspacePath(root, relative);
  const handle = await fs.open(absolute, 'r');
  try {
    const stat = await handle.stat();
    const maximum = 4 * 1024 * 1024;
    if (!stat.isFile() || stat.size > maximum) throw new Error('只能打开不超过 4 MB 的普通文本文件。');
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > maximum) throw new Error('文件超过 4 MB，请使用外部编辑器查看。');
    const content = buffer.subarray(0, length);
    if (content.includes(0)) throw new Error('二进制文件不能使用文本编辑器打开。');
    if (!isUtf8(content)) throw new Error('此文件不是有效的 UTF-8 文本，请使用支持原始编码的外部编辑器，避免保存时破坏内容。');
    return content.toString('utf8');
  } finally { await handle.close(); }
}

export async function workspaceDirectory(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('请选择有效的工作区目录。');
  const directory = path.resolve(value);
  if (directory === path.parse(directory).root || directory.split(path.sep).some(part => part.toLowerCase() === '.git')) throw new Error('请选择项目父文件夹，而不是磁盘根目录或 .git 目录。');
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('请选择普通文件夹，不支持符号链接或目录联接。');
  return fs.realpath(directory);
}

export async function hasGitMarker(directory: string): Promise<boolean> {
  try { const stat = await fs.lstat(path.join(directory, '.git')); return !stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Stop at each repository boundary: submodules belong to their owning repository. */
export async function discoverRepositories(value: unknown, childrenOnly = false): Promise<WorkspaceScan> {
  const root = await workspaceDirectory(value);
  const result: WorkspaceScan = { root, repositories: [], warnings: [], truncated: false };
  const queue = [{ directory: root, depth: 0 }], seen = new Set<string>();
  const deadline = Date.now() + 20_000;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (cursor >= 20_000 || result.repositories.length >= 100 || Date.now() > deadline) { result.truncated = true; break; }
    const { directory, depth } = queue[cursor];
    try {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const real = await fs.realpath(directory), relative = path.relative(root, real);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || seen.has(key(real))) continue;
      seen.add(key(real));
      if ((depth > 0 || !childrenOnly) && await hasGitMarker(real)) {
        const entry = await git.openRepository(real);
        if (key(entry.path) !== key(real)) throw new Error('Git 仓库根目录与发现的目录不一致。');
        result.repositories.push(entry);
        continue;
      }
      const entries = await fs.readdir(real, { withFileTypes: true });
      const folders = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !SKIP.has(entry.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
      if (depth >= 12) { if (folders.length) result.truncated = true; continue; }
      for (const folder of folders) {
        if (queue.length >= 20_000) { result.truncated = true; break; }
        queue.push({ directory: path.join(real, folder.name), depth: depth + 1 });
      }
    } catch (error) { result.warnings.push(`${path.relative(root, directory) || '.'}: ${String((error as Error).message).slice(0, 1500)}`); }
  }
  return result;
}

/** An empty Git wrapper created around existing projects should not hide the children. */
export async function scanWorkspace(value: unknown): Promise<WorkspaceScan> {
  const root = await workspaceDirectory(value);
  if (await hasGitMarker(root)) {
    const children = await discoverRepositories(root, true);
    let hasHead = false;
    try { hasHead = await git.repositoryHasCommits(root); } catch { /* Report the invalid root below. */ }
    if (children.repositories.length) {
      if (hasHead) {
        children.repositories.unshift(await git.openRepository(root));
        if (children.repositories.length > 100) { children.repositories.length = 100; children.truncated = true; }
      }
      return children;
    }
  }
  return discoverRepositories(root);
}
