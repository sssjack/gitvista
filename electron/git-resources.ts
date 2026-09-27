import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const MAX_PROCESSES = 6;
const MAX_REPO_READS = 2;
const MAX_PENDING = 256;
const MAX_BUFFERED = 32 * 1024 * 1024;
const reads = new AsyncLocalStorage<AbortSignal>();
const pending: Job[] = [];
const waitingQueries: Array<() => void> = [];
const activeReads = new Map<string, number>();
let active = 0;
let buffered = 0;
let activeQueries = 0;
interface Job { repo: string; signal?: AbortSignal; start: () => void; cancel: () => void }
interface SharedRead { controller: AbortController; promise: Promise<unknown>; subscribers: number; settled: boolean }
const queries = new Map<string, SharedRead>();

export function abortError(): Error { return Object.assign(new Error('查询已取消。'), { name: 'AbortError' }); }
export function currentReadSignal(): AbortSignal | undefined { return reads.getStore(); }
export function checkReadCancelled(): void { if (reads.getStore()?.aborted) throw abortError(); }
export function pathKey(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function drain(): void {
  while (active < MAX_PROCESSES) {
    const index = pending.findIndex(job => !job.signal || (activeReads.get(job.repo) || 0) < MAX_REPO_READS);
    if (index < 0) return;
    pending.splice(index, 1)[0].start();
  }
}

/** Limits actual processes, including the fan-out within one snapshot. */
export function scheduleGit<T>(repo: string, work: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  const signal = reads.getStore();
  if (signal?.aborted) return Promise.reject(abortError());
  if (pending.length >= MAX_PENDING) return Promise.reject(new Error('Git 查询较多，请稍候再试。'));
  const key = pathKey(repo);
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      repo: key, signal,
      cancel: () => {
        const index = pending.indexOf(job);
        if (index >= 0) pending.splice(index, 1);
        signal?.removeEventListener('abort', job.cancel);
        reject(abortError());
      },
      start: () => {
        signal?.removeEventListener('abort', job.cancel);
        if (signal?.aborted) { reject(abortError()); return; }
        active++;
        if (signal) activeReads.set(key, (activeReads.get(key) || 0) + 1);
        Promise.resolve().then(() => work(signal)).then(resolve, reject).finally(() => {
          active--;
          if (signal) {
            const count = (activeReads.get(key) || 1) - 1;
            if (count) activeReads.set(key, count); else activeReads.delete(key);
          }
          drain();
        });
      },
    };
    signal?.addEventListener('abort', job.cancel, { once: true });
    pending.push(job);
    drain();
  });
}

export function reserveGitOutput(bytes: number): boolean {
  if (buffered + bytes > MAX_BUFFERED) return false;
  buffered += bytes;
  return true;
}
export function releaseGitOutput(bytes: number): void { buffered = Math.max(0, buffered - bytes); }

/** Only terminate the tree belonging to the child we spawned; never kill by image name. */
export function terminateGitTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.once('error', () => { if (child.exitCode === null) child.kill(); });
    killer.once('exit', code => { if (code && child.exitCode === null) child.kill(); });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}

function startQuery<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      const index = waitingQueries.indexOf(start);
      if (index >= 0) waitingQueries.splice(index, 1);
      signal.removeEventListener('abort', cancel);
      reject(abortError());
    };
    const start = () => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) { reject(abortError()); return; }
      activeQueries++;
      Promise.resolve().then(() => reads.run(signal, work)).then(resolve, reject).finally(() => {
        activeQueries--;
        while (activeQueries < 8 && waitingQueries.length) waitingQueries.shift()!();
      });
    };
    if (signal.aborted) { reject(abortError()); return; }
    if (activeQueries < 8) start();
    else { signal.addEventListener('abort', cancel, { once: true }); waitingQueries.push(start); }
  });
}

export function sharedRead<T>(repo: string, request: unknown, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  const key = pathKey(repo) + '\0' + stable(request);
  let entry = queries.get(key);
  if (entry?.controller.signal.aborted) { queries.delete(key); entry = undefined; }
  if (!entry) {
    if (queries.size >= 128) return Promise.reject(new Error('Git 查询较多，请稍候再试。'));
    const controller = new AbortController();
    entry = { controller, subscribers: 0, settled: false, promise: Promise.resolve() };
    const created = entry;
    created.promise = Promise.resolve().then(() => startQuery(controller.signal, work)).finally(() => {
      created.settled = true;
      if (queries.get(key) === created) queries.delete(key);
      // A failed Promise.all must also stop its still-running sibling reads.
      controller.abort();
    });
    void created.promise.catch(() => undefined);
    queries.set(key, created);
  }
  const subscription = entry;
  subscription.subscribers++;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, value?: unknown) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      subscription.controller.signal.removeEventListener('abort', sharedAbort);
      subscription.subscribers--;
      if (!subscription.subscribers && !subscription.settled) subscription.controller.abort();
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(abortError());
    const sharedAbort = () => { if (!subscription.settled) abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    subscription.controller.signal.addEventListener('abort', sharedAbort, { once: true });
    subscription.promise.then(value => finish(undefined, value), error => finish(error));
  });
}

export function cancelReadQueries(): void {
  for (const entry of queries.values()) entry.controller.abort();
  queries.clear();
}
export function getGitResourceUsage() {
  return { activeProcesses: active, queuedProcesses: pending.length, bufferedBytes: buffered, sharedQueries: queries.size, activeQueries, queuedQueries: waitingQueries.length, maxActiveQueries: 8, maxProcesses: MAX_PROCESSES, maxReadsPerRepository: MAX_REPO_READS, maxBufferedBytes: MAX_BUFFERED };
}
