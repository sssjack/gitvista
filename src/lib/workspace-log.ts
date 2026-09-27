import type { GitCommit, GitLogOptions, GitLogResult, GitQuery, GitSnapshot, WorkspaceRepository } from '../../shared/types';
import { RESOURCE_BUDGET } from './resource-budget';

// The same commit can occur in two clones. Namespace graph nodes and selections
// so clicking a row always keeps its repository, even for identical hashes.
export const workspaceRef = (repo: string, ref: string) => `${encodeURIComponent(repo)}|${ref}`;
export function splitWorkspaceRef(value: string): { repo: string; ref: string } | undefined {
  const separator = value.indexOf('|');
  if (separator < 0) return undefined;
  try { return { repo: decodeURIComponent(value.slice(0, separator)), ref: value.slice(separator + 1) }; } catch { return undefined; }
}
export const relativeRepository = (root: string, repo: string) => repo.slice(root.replace(/[\\/]$/, '').length).replace(/^[\\/]/, '').replace(/\\/g, '/') || '.';
export const workspaceFilePath = (root: string, repo: string, file: string) => [relativeRepository(root, repo).replace(/^\.$/, ''), file].filter(Boolean).join('/');
const namespace = (repo: string, commit: GitCommit): GitCommit => ({ ...commit, hash: workspaceRef(repo, commit.hash), parents: commit.parents.map(hash => workspaceRef(repo, hash)) });

export function workspaceSnapshot(root: string, repositories: WorkspaceRepository[]): GitSnapshot {
  return {
    root, name: root.split(/[\\/]/).pop() || root, branch: '', upstream: '', ahead: 0, behind: 0, files: [], commits: [],
    branches: repositories.flatMap(item => (item.snapshot?.branches || []).map(branch => ({ ...branch, name: workspaceRef(item.entry.path, branch.name) }))),
    stashes: [], tags: [], remotes: [], worktrees: [], operation: '', gitVersion: '',
  };
}

type Cursor = { repo: string; options: GitLogOptions; buffer: GitCommit[]; skip: number; more: boolean };
type State = { cursors: Cursor[]; offset: number; warnings: string[] };
type Checkpoint = { offset: number; positions: number[] };

/** Incrementally merge repository pages without collapsing duplicate hashes or
 * breaking the topological order supplied by each individual repository. */
export function createWorkspaceLog(root: string, repositories: WorkspaceRepository[], scope: string, query: <T>(repo: string, query: GitQuery, requestKey?: string) => Promise<T>, cancelQuery: (requestKey: string) => void = () => {}) {
  let cache: { key: string; state: State } | undefined;
  let checkpoints: Checkpoint[] = [];
  const requests = new Map<string, { cancelled: boolean; keys: Set<string> }>();
  const members = repositories.filter(item => !scope || item.entry.path === scope);
  const memberKeys = new Map(members.map((item, index) => [item.entry.path, index]));
  const cancel = (key: string) => {
    const pending = requests.get(key); if (!pending) return;
    pending.cancelled = true; pending.keys.forEach(cancelQuery); requests.delete(key);
  };
  async function execute(request: GitQuery, requestKey: string, pending: { cancelled: boolean; keys: Set<string> }): Promise<unknown> {
    const check = () => { if (pending.cancelled) throw new Error('查询已取消'); };
    const read = async <T,>(repo: string, request: GitQuery) => {
      check(); const key = `${requestKey}:r${memberKeys.get(repo) ?? 0}`; pending.keys.add(key);
      try { const result = await query<T>(repo, request, key); check(); return result; }
      finally { pending.keys.delete(key); }
    };
    const fetchPage = async (cursor: Cursor, state: State) => {
      try {
        const size = Math.max(1, Math.min(25, Math.floor(RESOURCE_BUDGET.workspaceBufferCommits / Math.max(1, members.length))));
        const page = await read<GitLogResult>(cursor.repo, { type: 'log', log: { ...cursor.options, skip: cursor.skip, limit: size } });
        const budget = Math.max(1024, Math.floor(RESOURCE_BUDGET.historyBytes / Math.max(1, members.length)));
        let bytes = 0;
        cursor.buffer = page.commits.map(commit => namespace(cursor.repo, commit)).filter((commit, index) => { bytes += JSON.stringify(commit).length * 2; return index === 0 || bytes <= budget; });
        const shortened = cursor.buffer.length < page.commits.length;
        cursor.more = shortened || page.hasMore && page.nextSkip > cursor.skip;
        cursor.skip = shortened ? cursor.skip + cursor.buffer.length : page.nextSkip;
      } catch (error) { check(); cursor.more = false; const warning = `${relativeRepository(root, cursor.repo)}: ${String(error)}`; if (!state.warnings.includes(warning)) state.warnings.push(warning); }
    };
    if (request.type === 'logAuthors') {
      const authors = new Set<string>();
      // Suggestions are bounded; users can still type any author to search the entire history.
      for (let index = 0; index < members.length && authors.size < RESOURCE_BUDGET.authorSuggestions; index += 4) {
        check(); const pages = await Promise.allSettled(members.slice(index, index + 4).map(item => read<string[]>(item.entry.path, request))); check();
        for (const page of pages) if (page.status === 'fulfilled') for (const author of page.value) { if (authors.size >= RESOURCE_BUDGET.authorSuggestions) break; authors.add(author); }
      }
      return [...authors];
    }
    if (request.type === 'resolveRef') {
      const target = splitWorkspaceRef(request.ref || '');
      const candidates = target ? members.filter(item => item.entry.path === target.repo) : members;
      for (const item of candidates) {
        try { return namespace(item.entry.path, await read<GitCommit>(item.entry.path, { ...request, ref: target?.ref || request.ref })); } catch { check(); /* Try the next repository. */ }
      }
      throw new Error('No matching commit in the selected repositories.');
    }
    if (request.type !== 'log') throw new Error('Unsupported workspace history query.');
    const { skip = 0, limit = RESOURCE_BUDGET.historyPage, ...options } = request.log || {};
    const cacheKey = JSON.stringify(options);
    let state: State;
    if (!cache || cache.key !== cacheKey || cache.state.offset !== skip) {
      if (!cache || cache.key !== cacheKey) checkpoints = [];
      const branch = splitWorkspaceRef(options.branch || '');
      const cursors: Cursor[] = [];
      for (const item of members) {
        const repo = item.entry.path;
        if (branch && branch.repo !== repo) continue;
        let paths = options.paths;
        if (paths?.length) {
          const prefix = relativeRepository(root, repo);
          paths = paths.flatMap(value => {
            const file = value.replace(/\\/g, '/').replace(/\/$/, '');
            if (prefix === '.') return [file];
            if (file === prefix || prefix.startsWith(file + '/')) return ['.'];
            return file.startsWith(prefix + '/') ? [file.slice(prefix.length + 1)] : [];
          });
          if (!paths.length) continue;
        }
        cursors.push({ repo, options: { ...options, branch: branch?.ref || options.branch, paths }, buffer: [], skip: 0, more: true });
      }
      const checkpoint = checkpoints.filter(value => value.offset <= skip).sort((a, b) => b.offset - a.offset)[0];
      if (checkpoint) cursors.forEach((cursor, index) => { cursor.skip = checkpoint.positions[index] || 0; });
      state = { cursors, offset: checkpoint?.offset || 0, warnings: [] };
    } else state = { offset: cache.state.offset, warnings: [...cache.state.warnings], cursors: cache.state.cursors.map(cursor => ({ ...cursor, buffer: [...cursor.buffer] })) };
    const commits: GitCommit[] = [];
    let bytes = 0;
    while (commits.length < Math.min(limit, RESOURCE_BUDGET.historyPage)) {
      check();
      const empty = state.cursors.filter(cursor => !cursor.buffer.length && cursor.more);
      for (let index = 0; index < empty.length; index += 4) { await Promise.all(empty.slice(index, index + 4).map(cursor => fetchPage(cursor, state))); check(); }
      const available = state.cursors.filter(cursor => cursor.buffer.length);
      if (!available.length) break;
      available.sort((a, b) => Date.parse(b.buffer[0].committedDate || b.buffer[0].date) - Date.parse(a.buffer[0].committedDate || a.buffer[0].date) || a.repo.localeCompare(b.repo));
      const commit = available[0].buffer[0];
      const size = JSON.stringify(commit).length * 2;
      if (state.offset >= skip && commits.length && bytes + size > RESOURCE_BUDGET.historyBytes) break;
      available[0].buffer.shift();
      if (state.offset >= skip) { commits.push(commit); bytes += size; }
      state.offset++;
    }
    check(); cache = { key: cacheKey, state };
    checkpoints = [...checkpoints.filter(value => value.offset !== state.offset), { offset: state.offset, positions: state.cursors.map(cursor => cursor.skip - cursor.buffer.length) }].slice(-RESOURCE_BUDGET.workspaceCheckpoints);
    return { commits, nextSkip: state.offset, hasMore: state.cursors.some(cursor => cursor.buffer.length || cursor.more), warning: state.warnings.join('\n') } satisfies GitLogResult;
  }
  const run = <T>(request: GitQuery, requestKey: string = request.type): Promise<T> => {
    cancel(requestKey);
    const pending = { cancelled: false, keys: new Set<string>() }; requests.set(requestKey, pending);
    return execute(request, requestKey, pending).finally(() => { if (requests.get(requestKey) === pending) requests.delete(requestKey); }) as Promise<T>;
  };
  return Object.assign(run, { cancel, dispose: () => { [...requests.keys()].forEach(cancel); cache = undefined; checkpoints = []; } });
}
