import type { GitBranch, GitCommit, GitFile, GitFileHistoryCommit, GitStash, GitTag, GitWorktree } from '../shared/types';

export const COMMIT_FORMAT = '%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D%x00%cI%x00%cn%x00%ce%x1e';

export function parseStatus(text: string): { files: GitFile[]; branch: string; upstream: string; ahead: number; behind: number } {
  const records = text.split('\0');
  const files: GitFile[] = [];
  let branch = '';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('## ')) {
      const header = record.slice(3);
      if (header.startsWith('No commits yet on ')) branch = header.slice(18);
      else if (header.startsWith('Initial commit on ')) branch = header.slice(18);
      else if (header.startsWith('HEAD ')) branch = 'HEAD (分离状态)';
      else {
        const tracking = header.split(' [')[0].split('...');
        branch = tracking[0];
        upstream = tracking[1] || '';
        ahead = Number(header.match(/ahead (\d+)/)?.[1] || 0);
        behind = Number(header.match(/behind (\d+)/)?.[1] || 0);
      }
      continue;
    }
    const x = record[0];
    const y = record[1];
    const code = record.slice(0, 2);
    const file: GitFile = {
      path: record.slice(3), index: x, worktree: y,
      staged: x !== ' ' && x !== '?' && x !== '!',
      unstaged: y !== ' ' && y !== '!',
      conflict: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code),
    };
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') file.oldPath = records[++index];
    files.push(file);
  }
  return { files, branch, upstream, ahead, behind };
}

export function parseCommits(text: string): GitCommit[] {
  return text.split('\x1e').map(record => record.replace(/^\n+/, '')).filter(record => record.includes('\0')).map(record => {
    const [hash, short, parents, author, email, date, subject, refs, committedDate, committer, committerEmail] = record.split('\0');
    return { hash, short, parents: parents ? parents.split(' ') : [], author, email, date, subject, refs: refs || '', ...(committedDate ? { committedDate, committer, committerEmail } : {}) };
  });
}

// --name-status -z 的路径按字段读取，不能按行拆分：文件名可以包含换行。
export function parseFileHistory(text: string, path: string): GitFileHistoryCommit[] {
  const fields = text.split('\0');
  const result: GitFileHistoryCommit[] = [];
  let index = 0, currentPath = path;
  while (index < fields.length) {
    if (!fields[index].trim()) { index++; continue; }
    const metadata = fields.slice(index, index + 11);
    if (!/^[a-f0-9]{40,64}$/.test(metadata[0]) || metadata.length < 11) break;
    const [commit] = parseCommits(metadata.join('\0'));
    index += 11;
    const changes: { path: string; oldPath?: string }[] = [];
    while (index < fields.length) {
      const status = fields[index].replace(/^\n+/, '');
      if (!status) { index++; continue; }
      if (!/^[A-Z][0-9]*$/.test(status)) break;
      index++;
      const first = fields[index++];
      changes.push(/^[RC]/.test(status) ? { oldPath: first, path: fields[index++] } : { path: first });
    }
    const file = changes.find(change => change.path === currentPath) || changes[0] || { path: currentPath };
    result.push({ ...commit, ...file });
    currentPath = file.oldPath || file.path;
  }
  return result;
}

export function parseBranches(text: string): GitBranch[] {
  return text.split('\n').filter(Boolean).map(line => {
    const [full, current, upstream, hash, subject, symbolic] = line.split('\0');
    return {
      name: full.replace(/^refs\/(heads|remotes)\//, ''), current: current === '*',
      remote: full.startsWith('refs/remotes/'), upstream: upstream || '', hash, subject: subject || '', symbolic,
    };
  }).filter(branch => !branch.symbolic).map(({ symbolic: _symbolic, ...branch }) => branch);
}

export function parseStashes(text: string): GitStash[] {
  return text.split('\x1e').map(line => line.replace(/^\n+/, '')).filter(line => line.includes('\0')).map(line => {
    const [ref, hash, subject, date] = line.split('\0');
    return { ref, hash, subject, date };
  });
}

export function parseTags(text: string): GitTag[] {
  return text.split('\n').filter(Boolean).map(line => {
    const [name, hash, subject] = line.split('\0');
    return { name, hash, subject: subject || '' };
  });
}

export function parseWorktrees(text: string): GitWorktree[] {
  const result: GitWorktree[] = [];
  let current: GitWorktree | undefined;
  for (const entry of text.split('\0')) {
    if (entry.startsWith('worktree ')) {
      current = { path: entry.slice(9), head: '', branch: '', bare: false };
      result.push(current);
    } else if (current && entry.startsWith('HEAD ')) current.head = entry.slice(5);
    else if (current && entry.startsWith('branch ')) current.branch = entry.slice(7).replace(/^refs\/heads\//, '');
    else if (current && entry === 'bare') current.bare = true;
    else if (current && entry === 'detached') current.branch = 'HEAD (分离状态)';
  }
  return result;
}

export function parseNumstat(text: string): { path: string; additions: string; deletions: string }[] {
  const fields = text.split('\0');
  const files: { path: string; additions: string; deletions: string }[] = [];
  for (let index = 0; index < fields.length; index++) {
    if (!fields[index]) continue;
    const first = fields[index].indexOf('\t');
    const second = fields[index].indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const additions = fields[index].slice(0, first);
    const deletions = fields[index].slice(first + 1, second);
    let filePath = fields[index].slice(second + 1);
    if (!filePath) {
      index++;
      filePath = fields[++index] || '';
    }
    files.push({ path: filePath, additions, deletions });
  }
  return files;
}

export function parseNameChanges(text: string): { path: string; oldPath?: string; status: string }[] {
  const parts = text.split('\0');
  const changes: { path: string; oldPath?: string; status: string }[] = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index++];
    if (!status) continue;
    let filePath = parts[index++] || '';
    let oldPath: string | undefined;
    if (status.startsWith('R') || status.startsWith('C')) { oldPath = filePath; filePath = parts[index++] || ''; }
    changes.push({ path: filePath, ...(oldPath ? { oldPath } : {}), status });
  }
  return changes;
}

export function parseNameStatus(text: string): Map<string, string> {
  return new Map(parseNameChanges(text).map(file => [file.path, file.status]));
}
