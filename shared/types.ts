export interface GitFile { path: string; oldPath?: string; index: string; worktree: string; staged: boolean; unstaged: boolean; conflict: boolean }
export interface GitCommit { hash: string; short: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string }
export interface GitBranch { name: string; current: boolean; remote: boolean; upstream: string; hash: string; subject: string }
export interface GitStash { ref: string; hash: string; subject: string; date: string }
export interface GitTag { name: string; hash: string; subject: string }
export interface GitRemote { name: string; fetch: string; push: string }
export interface GitWorktree { path: string; head: string; branch: string; bare: boolean }
export interface GitTreeEntry { path: string; type: 'blob' | 'tree' | 'commit'; size: number | null }
export interface GitSnapshot { root: string; name: string; branch: string; upstream: string; ahead: number; behind: number; files: GitFile[]; commits: GitCommit[]; branches: GitBranch[]; stashes: GitStash[]; tags: GitTag[]; remotes: GitRemote[]; worktrees: GitWorktree[]; operation: string; gitVersion: string }
export interface DiffResult { text: string; binary: boolean; truncated: boolean }
export interface CommitDetail { commit: GitCommit; body: string; files: { path: string; status: string; additions: string; deletions: string }[] }
export interface GitQuery { type: 'snapshot' | 'diff' | 'commit' | 'blame' | 'fileHistory' | 'reflog' | 'compare' | 'submodules' | 'fileContent' | 'tree'; path?: string; staged?: boolean; ref?: string; to?: string; search?: string; author?: string; limit?: number; }
export type GitActionType = 'stage' | 'unstage' | 'commit' | 'fetch' | 'pull' | 'push' | 'switch' | 'branchCreate' | 'branchRename' | 'branchDelete' | 'merge' | 'rebase' | 'cherryPick' | 'revert' | 'reset' | 'stashSave' | 'stashApply' | 'stashPop' | 'stashDrop' | 'tagCreate' | 'tagDelete' | 'remoteAdd' | 'remoteRemove' | 'remoteSetUrl' | 'discard' | 'resolve' | 'continue' | 'abort' | 'skip' | 'applyPatch' | 'ignore' | 'worktreeAdd' | 'worktreeRemove' | 'submoduleUpdate' | 'saveFile';
export interface GitAction { type: GitActionType; paths?: string[]; path?: string; ref?: string; name?: string; message?: string; remote?: string; url?: string; mode?: string; content?: string; amend?: boolean; signoff?: boolean; force?: boolean; rebase?: boolean; includeUntracked?: boolean; staged?: boolean; }
export interface ActionResult { output: string }
export interface RepoEntry { path: string; name: string; lastOpened: string }
export type AppTheme = 'dark' | 'light' | 'midnight' | 'nord' | 'forest' | 'rose';
export interface AppPreferences { theme: AppTheme; gitPath: string; pullStrategy: 'ff-only' | 'merge' | 'rebase'; diffView: 'split' | 'unified'; codeFontSize: number; wordWrap: boolean }
export const DEFAULT_PREFERENCES: AppPreferences = { theme: 'dark', gitPath: 'git', pullStrategy: 'ff-only', diffView: 'split', codeFontSize: 12, wordWrap: false };
export interface AppSettings extends AppPreferences { repos: RepoEntry[]; lastRepo?: string; }
export interface IdentityFields { name: string; email: string }
export interface GitIdentity { local: IdentityFields; global: IdentityFields; effective: IdentityFields }
export interface GitIdentityUpdate extends IdentityFields { scope: 'local' | 'global' }
export interface GitVistaApi {
  settings(): Promise<AppSettings>;
  setTheme(theme: AppTheme): Promise<void>;
  updatePreferences(preferences: AppPreferences): Promise<AppSettings>;
  browseGitPath(): Promise<string | null>;
  testGitPath(gitPath: string): Promise<{ version: string }>;
  getGitIdentity(repo: string): Promise<GitIdentity>;
  setGitIdentity(repo: string, identity: GitIdentityUpdate): Promise<GitIdentity>;
  openRepository(path?: string): Promise<RepoEntry | null>;
  forgetRepository(path: string): Promise<void>;
  cloneRepository(url: string, parent?: string, name?: string): Promise<RepoEntry | null>;
  initRepository(path?: string): Promise<RepoEntry | null>;
  query<T = unknown>(repo: string, query: GitQuery): Promise<T>;
  action(repo: string, action: GitAction): Promise<ActionResult>;
  exportPatch(repo: string, ref?: string): Promise<string | null>;
  revealPath(repo: string, relative?: string): Promise<void>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
}
declare global { interface Window { gitvista: GitVistaApi } }
