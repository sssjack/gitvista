import { pairDiffLines, type DiffLine } from './diff-lines';

export type ChangeKind = 'context' | 'add' | 'remove' | 'modify';
export type DisplayDiffPair = { kind: ChangeKind; left?: DiffLine; right?: DiffLine } | { kind: 'gap' };
export type DisplayDiffLine = { kind: ChangeKind; line: DiffLine } | { kind: 'gap' };
export interface DiffFilePresentation {
  key: string;
  path: string;
  oldPath?: string;
  binary: boolean;
  summary: string[];
  pairs: DisplayDiffPair[];
  unified: DisplayDiffLine[];
  counts: { add: number; modify: number; remove: number };
}

function decodePath(value: string): string {
  if (!value.startsWith('"')) return value;
  try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
}

function fileHeaderPath(value: string): string | undefined {
  const decoded = decodePath(value);
  return decoded === '/dev/null' ? undefined : decoded.replace(/^[ab]\//, '');
}

function gitHeaderPaths(value: string): [string | undefined, string | undefined] {
  const body = value.slice('diff --git '.length);
  if (body.startsWith('"')) {
    const match = /^("(?:\\.|[^"\\])*"|\S+) (.+)$/.exec(body);
    if (match) return [fileHeaderPath(match[1]), fileHeaderPath(match[2])];
  }
  const separators = [...body.matchAll(/ b\//g)].map(match => match.index!);
  const separator = separators.find(index => body.slice(2, index) === body.slice(index + 3)) ?? separators[0];
  return separator === undefined ? [undefined, undefined] : [fileHeaderPath(body.slice(0, separator)), fileHeaderPath(body.slice(separator + 1))];
}

/** Presentation is built per hunk/file, so hidden headers never merge unrelated changes. */
export function presentDiff(lines: DiffLine[], fallbackPath?: string): DiffFilePresentation[] {
  const groups: DiffLine[][] = [];
  let group: DiffLine[] = [];
  for (const line of lines) {
    if (/^diff --(?:git|cc|combined) /.test(line.text) && line.kind === 'meta' && group.length) { if (group.some(row => row.text.trim())) groups.push(group); group = []; }
    group.push(line);
  }
  if (group.some(row => row.text.trim())) groups.push(group);
  return groups.map((records, fileIndex) => {
    let oldPath: string | undefined; let newPath: string | undefined;
    let oldMode = ''; let newMode = ''; let created = false; let deleted = false; let binary = false;
    let renamed = false; let copied = false;
    const blocks: DiffLine[][] = []; let block: DiffLine[] = [];
    for (const row of records) {
      if (row.kind === 'hunk') { if (block.length) blocks.push(block); block = []; continue; }
      if (row.kind !== 'meta') { block.push(row); continue; }
      // End-of-file newline markers annotate a line, and must not split a replacement pair.
      if (row.text.startsWith('\\ No newline')) continue;
      if (block.length) { blocks.push(block); block = []; }
      if (row.text.startsWith('diff --git ')) [oldPath, newPath] = gitHeaderPaths(row.text);
      else if (row.text.startsWith('--- ')) oldPath = fileHeaderPath(row.text.slice(4));
      else if (row.text.startsWith('+++ ')) newPath = fileHeaderPath(row.text.slice(4));
      else if (row.text.startsWith('rename from ')) { oldPath = decodePath(row.text.slice(12)); renamed = true; }
      else if (row.text.startsWith('rename to ')) { newPath = decodePath(row.text.slice(10)); renamed = true; }
      else if (row.text.startsWith('copy from ')) { oldPath = decodePath(row.text.slice(10)); copied = true; }
      else if (row.text.startsWith('copy to ')) { newPath = decodePath(row.text.slice(8)); copied = true; }
      else if (row.text.startsWith('old mode ')) oldMode = row.text.slice(9);
      else if (row.text.startsWith('new mode ')) newMode = row.text.slice(9);
      else if (row.text.startsWith('new file mode ')) created = true;
      else if (row.text.startsWith('deleted file mode ')) deleted = true;
      if (/^(?:Binary files |GIT binary patch)/.test(row.text)) binary = true;
    }
    if (block.length) blocks.push(block);
    const pairs: DisplayDiffPair[] = []; const unified: DisplayDiffLine[] = [];
    const counts = { add: 0, modify: 0, remove: 0 };
    blocks.forEach((source, blockIndex) => {
      if (blockIndex) { pairs.push({ kind: 'gap' }); unified.push({ kind: 'gap' }); }
      const classified = new Map<DiffLine, ChangeKind>();
      for (const pair of pairDiffLines(source)) {
        const kind: ChangeKind = pair.left?.kind === 'remove' && pair.right?.kind === 'add' ? 'modify'
          : pair.left?.kind === 'remove' ? 'remove' : pair.right?.kind === 'add' ? 'add' : 'context';
        pairs.push({ ...pair, kind });
        if (kind !== 'context') counts[kind]++;
        if (pair.left) classified.set(pair.left, kind);
        if (pair.right) classified.set(pair.right, kind);
      }
      source.forEach(line => unified.push({ line, kind: classified.get(line) || 'context' }));
    });
    const summary: string[] = [];
    if (created) summary.push(pairs.length || binary ? '新增文件' : '新增空文件');
    if (deleted) summary.push(pairs.length || binary ? '删除文件' : '删除空文件');
    if (renamed || copied) summary.push(`${copied ? '复制' : '重命名'}：${oldPath || '原路径'} → ${newPath || '新路径'}`);
    if (oldMode && newMode) summary.push(`文件权限变更：${oldMode} → ${newMode}`);
    if (binary) summary.push('二进制内容发生变化');
    if (!pairs.length && !summary.length) summary.push('文件信息发生变化，未包含可显示的文本差异。');
    return { key: `${fileIndex}:${newPath || oldPath || ''}`, path: newPath || oldPath || fallbackPath || `文件 ${fileIndex + 1}`, oldPath, binary, summary, pairs, unified, counts };
  });
}
