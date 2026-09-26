export interface GitFile { path: string; oldPath?: string; index: string; worktree: string; staged: boolean; unstaged: boolean; conflict: boolean }
export interface GitCommitFile { path: string; oldPath?: string; status: string }
export interface GitCommit { hash: string; short: string; parents: string[]; author: string; email: string; date: string; subject: string; refs: string; committedDate?: string; committer?: string; committerEmail?: string }
export interface GitFileHistoryCommit extends GitCommit { path: string; oldPath?: string }
export interface GitBranch { name: string; current: boolean; remote: boolean; upstream: string; hash: string; subject: string }
export interface GitStash { ref: string; hash: string; subject: string; date: string }
export interface GitTag { name: string; hash: string; subject: string }
export interface GitRemote { name: string; fetch: string; push: string }
export interface GitWorktree { path: string; head: string; branch: string; bare: boolean }
export interface GitTreeEntry { path: string; type: 'blob' | 'tree' | 'commit'; size: number | null }
export interface GitWorkingState { files: GitFile[]; operation: string }
export interface GitSnapshot { root: string; name: string; branch: string; upstream: string; ahead: number; behind: number; files: GitFile[]; commits: GitCommit[]; commitsHasMore?: boolean; commitsOrder?: 'date' | 'topo'; branches: GitBranch[]; stashes: GitStash[]; tags: GitTag[]; remotes: GitRemote[]; worktrees: GitWorktree[]; operation: string; gitVersion: string }
export interface DiffResult { text: string; binary: boolean; truncated: boolean }
export interface CommitDetail { commit: GitCommit; body: string; files: { path: string; oldPath?: string; status: string; additions: string; deletions: string }[]; root: string; branches: string[]; inCurrentBranch: boolean }
export interface GitLogOptions { text?: string; regex?: boolean; matchCase?: boolean; branch?: string; author?: string; since?: string; until?: string; paths?: string[]; order?: 'date' | 'topo'; firstParent?: boolean; noMerges?: boolean; skip?: number; limit?: number }
export interface GitLogResult { commits: GitCommit[]; hasMore: boolean; nextSkip: number; warning?: string }
export interface GitQuery { type: 'snapshot' | 'status' | 'log' | 'resolveRef' | 'logAuthors' | 'diff' | 'commit' | 'commitFiles' | 'blame' | 'fileHistory' | 'reflog' | 'compare' | 'submodules' | 'fileContent' | 'tree' | 'pushPreview'; remote?: string; base?: string; path?: string; oldPath?: string; staged?: boolean; workingTree?: boolean; ref?: string; to?: string; search?: string; author?: string; limit?: number; log?: GitLogOptions }
export type GitActionType = 'stage' | 'unstage' | 'commit' | 'fetch' | 'pull' | 'push' | 'switch' | 'branchCreate' | 'branchRename' | 'branchDelete' | 'merge' | 'rebase' | 'cherryPick' | 'revert' | 'revertFile' | 'writeCommitGraph' | 'reset' | 'stashSave' | 'stashApply' | 'stashPop' | 'stashDrop' | 'tagCreate' | 'tagDelete' | 'remoteAdd' | 'remoteRemove' | 'remoteSetUrl' | 'discard' | 'resolve' | 'continue' | 'abort' | 'skip' | 'applyPatch' | 'ignore' | 'worktreeAdd' | 'worktreeRemove' | 'submoduleUpdate' | 'saveFile';
export interface GitAction { type: GitActionType; paths?: string[]; path?: string; ref?: string; name?: string; message?: string; remote?: string; url?: string; mode?: string; content?: string; amend?: boolean; signoff?: boolean; force?: boolean; rebase?: boolean; includeUntracked?: boolean; staged?: boolean; expectedHead?: string; }
export interface ActionResult { output: string }
export interface RepoEntry { path: string; name: string; lastOpened: string; kind?: 'workspace' }
export interface WorkspaceScan { root: string; repositories: RepoEntry[]; warnings: string[]; truncated: boolean }
export interface WorkspaceRepository { entry: RepoEntry; snapshot?: GitSnapshot; error?: string }
export interface WorkspaceOverview { scan: WorkspaceScan; repositories: WorkspaceRepository[] }
export interface WorkspaceFileEntry { path: string; name: string; type: 'directory' | 'file' | 'link' }
export interface WorkspaceDirectory { entries: WorkspaceFileEntry[]; truncated: boolean }
export interface WorkspacePushItem { repo: string; preview?: PushPreview; files: GitFile[]; error?: string }
export interface WorkspacePushPlan { id: string; includeChanges: boolean; items: WorkspacePushItem[] }
export interface WorkspaceProgress { root: string; repo: string; operation: 'fetch' | 'pull' | 'push'; status: 'running' | 'success' | 'failed' | 'skipped'; output: string; commitHash?: string }
export interface WorkspaceBatch { operation: 'fetch' | 'pull' | 'push'; repos: string[]; planId?: string; message?: string }
export type AppTheme = 'dark' | 'light' | 'midnight' | 'nord' | 'forest' | 'rose' | 'darcula' | 'deep';
export type AppLanguage = 'en' | 'zh';
export interface AppPreferences { language: AppLanguage; theme: AppTheme; gitPath: string; pullStrategy: 'ff-only' | 'merge' | 'rebase'; diffView: 'split' | 'unified'; codeFontSize: number; wordWrap: boolean }
export const DEFAULT_PREFERENCES: AppPreferences = { language: 'en', theme: 'darcula', gitPath: 'git', pullStrategy: 'ff-only', diffView: 'split', codeFontSize: 12, wordWrap: false };
export interface AppSettings extends AppPreferences { repos: RepoEntry[]; lastRepo?: string; }
export interface IdentityFields { name: string; email: string }
export interface GitIdentity { local: IdentityFields; global: IdentityFields; effective: IdentityFields }
export interface GitIdentityUpdate extends IdentityFields { scope: 'local' | 'global' }
export interface RepositoryCredentials { username: string; secret: string }
export interface DesktopState { mode: 'main' | 'mini'; collapsed: boolean; expanded: boolean; direction: 'left' | 'right'; edge: 'left' | 'right' | 'top' | 'bottom' | null; frame: MiniFrame; repo: string; commits: GitCommit[]; busy: boolean; error: string; language: AppLanguage; theme: AppTheme }
export type DesktopCommand = 'mini' | 'tray' | 'restore' | 'refresh' | 'pull' | 'latest' | 'quit' | 'expand';
export interface MiniFrame { x: number; y: number; width: number; height: number }
export interface MiniBarApi {
  desktopState(): Promise<DesktopState>;
  desktopCommand(command: DesktopCommand): Promise<void>;
  onDesktopState(listener: (state: DesktopState) => void): () => void;
  onFrame(listener: (frame: MiniFrame) => void): () => void;
}
export interface GitVistaApi {
  settings(): Promise<AppSettings>;
  setTheme(theme: AppTheme): Promise<void>;
  updatePreferences(preferences: AppPreferences): Promise<AppSettings>;
  browseGitPath(): Promise<string | null>;
  testGitPath(gitPath: string): Promise<{ version: string }>;
  getGitIdentity(repo: string): Promise<GitIdentity>;
  setGitIdentity(repo: string, identity: GitIdentityUpdate): Promise<GitIdentity>;
  openRepository(path?: string, singleRepository?: boolean): Promise<RepoEntry | null>;
  openWorkspace(path?: string): Promise<RepoEntry | null>;
  workspaceOverview(root: string): Promise<WorkspaceOverview>;
  workspaceDirectory(root: string, relative?: string): Promise<WorkspaceDirectory>;
  workspaceFile(root: string, relative: string): Promise<string>;
  workspacePushPreview(root: string, repos: string[], includeChanges: boolean): Promise<WorkspacePushPlan>;
  workspaceBatch(root: string, request: WorkspaceBatch): Promise<WorkspaceProgress[]>;
  onWorkspaceProgress(listener: (progress: WorkspaceProgress) => void): () => void;
  forgetRepository(path: string): Promise<void>;
  cloneRepository(url: string, parent?: string, name?: string, credentials?: RepositoryCredentials): Promise<RepoEntry | null>;
  chooseDirectory(): Promise<string | null>;
  setRepositoryCredentials(repo: string, remote: string, credentials: RepositoryCredentials | null): Promise<void>;
  desktopState(): Promise<DesktopState>;
  desktopCommand(command: DesktopCommand): Promise<void>;
  onDesktopState(listener: (state: DesktopState) => void): () => void;
  onRepositoryRefresh(listener: () => void): () => void;
  initRepository(path?: string): Promise<RepoEntry | null>;
  query<T = unknown>(repo: string, query: GitQuery): Promise<T>;
  action(repo: string, action: GitAction): Promise<ActionResult>;
  exportPatch(repo: string, ref?: string): Promise<string | null>;
  revealPath(repo: string, relative?: string): Promise<void>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
}
declare global { interface Window { gitvista: GitVistaApi; gitvistaMini: MiniBarApi } }

export interface PushPreview { branch: string; remote: string; target: string; head: string; base: string; commits: GitCommit[]; files: { path: string; status: string }[]; total: number; }
