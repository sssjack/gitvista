import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathKey } from './git-resources';

type Kind = 'preview' | 'commit' | 'credentials';
type State = 'active' | 'complete' | 'recovery';
interface Marker { owner: 'gitvista'; version: 1; kind: Kind; pid: number; createdAt: number; state: State }
export interface GitTransaction { directory: string; parent: string; marker: Marker }
const MARKER = 'gitvista-transaction.json';
const RECLAIM_AGE = 60 * 60 * 1000;
const lastSweep = new Map<string, number>();

async function assertOrdinaryTree(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink()) throw new Error('不能清理符号链接或目录联接。');
  if (stat.isDirectory()) for (const entry of await fs.readdir(target)) await assertOrdinaryTree(path.join(target, entry));
}
function isChild(parent: string, target: string): boolean {
  return pathKey(path.dirname(path.resolve(target))) === pathKey(parent) && /^gitvista-(preview|commit|credentials)-[a-zA-Z0-9]+$/.test(path.basename(target));
}
async function assertParents(target: string): Promise<void> {
  let cursor = path.resolve(target);
  while (true) {
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('事务目录不能位于符号链接或目录联接中。');
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
async function readMarker(directory: string): Promise<Marker | undefined> {
  try {
    const file = path.join(directory, MARKER);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) return;
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as Marker;
    if (data.owner === 'gitvista' && data.version === 1 && ['preview', 'commit', 'credentials'].includes(data.kind)
      && ['active', 'complete', 'recovery'].includes(data.state) && Number.isSafeInteger(data.pid) && data.pid > 0
      && Number.isSafeInteger(data.createdAt) && data.createdAt > 0 && path.basename(directory).startsWith(`gitvista-${data.kind}-`)) return data;
  } catch { /* Unknown files are never treated as owned transactions. */ }
}
async function removeTransaction(parent: string, directory: string): Promise<void> {
  if (!isChild(parent, directory)) throw new Error('事务清理路径超出所属目录。');
  await assertParents(directory);
  await assertOrdinaryTree(directory);
  await fs.rm(path.resolve(directory), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export async function reclaimGitTransactions(parent: string): Promise<void> {
  const resolved = path.resolve(parent), key = pathKey(resolved);
  if (Date.now() - (lastSweep.get(key) || 0) < 300_000) return;
  lastSweep.set(key, Date.now());
  if (lastSweep.size > 128) lastSweep.delete(lastSweep.keys().next().value!);
  try {
    await assertParents(resolved);
    for (const entry of await fs.readdir(resolved, { withFileTypes: true })) {
      const directory = path.join(resolved, entry.name);
      if (!entry.isDirectory() || !isChild(resolved, directory)) continue;
      const marker = await readMarker(directory);
      if (!marker || marker.state === 'recovery' || Date.now() - marker.createdAt < RECLAIM_AGE) continue;
      if (marker.state !== 'complete' && processAlive(marker.pid)) continue;
      // An interrupted commit may be the only copy needed for index recovery.
      if (marker.kind === 'commit' && marker.state !== 'complete') continue;
      await removeTransaction(resolved, directory).catch(() => undefined);
    }
  } catch { /* Cleanup is best effort and must not prevent repository access. */ }
}

export async function createGitTransaction(parent: string, kind: Kind): Promise<GitTransaction> {
  parent = path.resolve(parent);
  await assertParents(parent);
  await reclaimGitTransactions(parent);
  const directory = await fs.mkdtemp(path.join(parent, `gitvista-${kind}-`));
  const marker: Marker = { owner: 'gitvista', version: 1, kind, pid: process.pid, createdAt: Date.now(), state: 'active' };
  const transaction = { directory, parent, marker };
  try { await fs.writeFile(path.join(directory, MARKER), JSON.stringify(marker), { mode: 0o600, flag: 'wx' }); }
  catch (error) { await removeTransaction(parent, directory).catch(() => undefined); throw error; }
  return transaction;
}

export async function finishGitTransaction(transaction: GitTransaction, recovery = false): Promise<void> {
  try {
    await assertParents(transaction.directory);
    transaction.marker.state = recovery ? 'recovery' : 'complete';
    const temporary = path.join(transaction.directory, MARKER + '.tmp');
    await fs.writeFile(temporary, JSON.stringify(transaction.marker), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, path.join(transaction.directory, MARKER));
    if (!recovery) await removeTransaction(transaction.parent, transaction.directory);
  } catch (error) {
    // One bounded diagnostic per operation, with no credentials or Git output.
    console.warn('GitVista 临时事务暂未回收：', transaction.directory, (error as NodeJS.ErrnoException).code || 'cleanup-failed');
  }
}
