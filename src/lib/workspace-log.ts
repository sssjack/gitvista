import type { GitCommit, GitLogOptions, GitLogResult, GitQuery, GitSnapshot, WorkspaceRepository } from '../../shared/types';

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
type State = { cursors: Cursor[]; commits: GitCommit[]; warnings: string[] };

/** Incrementally merge repository pages without collapsing duplicate hashes or
 * breaking the topological order supplied by each individual repository. */
export function createWorkspaceLog(root: string, repositories: WorkspaceRepository[], scope: string, query: <T>(repo: string, query: GitQuery) => Promise<T>) {
  let cache: { key: string; state: State } | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const members = repositories.filter(item => !scope || item.entry.path === scope);
  const fetchPage = async (cursor: Cursor, state: State) => {
    try {
      const page = await query<GitLogResult>(cursor.repo, { type: 'log', log: { ...cursor.options, skip: cursor.skip, limit: 250 } });
      cursor.buffer.push(...page.commits.map(commit => namespace(cursor.repo, commit)));
      cursor.more = page.hasMore && page.nextSkip > cursor.skip; cursor.skip = page.nextSkip;
    } catch (error) { cursor.more = false; state.warnings.push(`${relativeRepository(root, cursor.repo)}: ${String(error)}`); }
  };
  async function execute(request: GitQuery): Promise<unknown> {
    if (request.type === 'logAuthors') {
      const authors = new Set<string>();
      for (let index = 0; index < members.length; index += 4) {
        const pages = await Promise.allSettled(members.slice(index, index + 4).map(item => query<string[]>(item.entry.path, request)));
        for (const page of pages) if (page.status === 'fulfilled') page.value.forEach(author => authors.add(author));
      }
      return [...authors];
    }
    if (request.type === 'resolveRef') {
      const target = splitWorkspaceRef(request.ref || '');
      const candidates = target ? members.filter(item => item.entry.path === target.repo) : members;
      for (const item of candidates) {
        try { return namespace(item.entry.path, await query<GitCommit>(item.entry.path, { ...request, ref: target?.ref || request.ref })); } catch { /* Try the next repository. */ }
      }
      throw new Error('No matching commit in the selected repositories.');
    }
    if (request.type !== 'log') throw new Error('Unsupported workspace history query.');
    const { skip = 0, limit = 250, ...options } = request.log || {};
    const cacheKey = JSON.stringify(options);
    if (!cache || cache.key !== cacheKey) {
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
      const state: State = { cursors, commits: [], warnings: [] };
      for (let index = 0; index < cursors.length; index += 4) await Promise.all(cursors.slice(index, index + 4).map(cursor => fetchPage(cursor, state)));
      cache = { key: cacheKey, state };
    }
    const state = cache.state;
    while (state.commits.length < skip + limit + 1) {
      for (const cursor of state.cursors) if (!cursor.buffer.length && cursor.more) await fetchPage(cursor, state);
      const available = state.cursors.filter(cursor => cursor.buffer.length);
      if (!available.length) break;
      available.sort((a, b) => Date.parse(b.buffer[0].committedDate || b.buffer[0].date) - Date.parse(a.buffer[0].committedDate || a.buffer[0].date) || a.repo.localeCompare(b.repo));
      state.commits.push(available[0].buffer.shift()!);
    }
    const commits = state.commits.slice(skip, skip + limit);
    return { commits, nextSkip: skip + commits.length, hasMore: state.commits.length > skip + limit || state.cursors.some(cursor => cursor.buffer.length || cursor.more), warning: state.warnings.join('\n') } satisfies GitLogResult;
  }
  return <T>(request: GitQuery): Promise<T> => {
    const result = queue.then(() => execute(request));
    queue = result.catch(() => {});
    return result as Promise<T>;
  };
}
