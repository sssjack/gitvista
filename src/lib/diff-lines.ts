export type DiffLine = { text: string; kind: 'context' | 'add' | 'remove' | 'meta' | 'hunk'; old: string; next: string };
export type DiffPair = { left?: DiffLine; right?: DiffLine };

export function parseDiffLines(text: string): DiffLine[] {
  let old = 0; let next = 0; let inHunk = false;
  let oldRemaining = 0; let nextRemaining = 0;
  const lines = text.replace(/\n$/, '').split('\n');
  return lines.map(text => {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[3]); oldRemaining = Number(hunk[2] ?? 1); nextRemaining = Number(hunk[4] ?? 1); inHunk = true; return { text, kind: 'hunk', old: '', next: '' }; }
    if (/^diff --(?:git|cc|combined) /.test(text)) inHunk = false;
    if (inHunk && nextRemaining > 0 && text.startsWith('+')) { nextRemaining--; return { text, kind: 'add', old: '', next: String(next++) }; }
    if (inHunk && oldRemaining > 0 && text.startsWith('-')) { oldRemaining--; return { text, kind: 'remove', old: String(old++), next: '' }; }
    if (inHunk && oldRemaining > 0 && nextRemaining > 0 && text.startsWith(' ')) { oldRemaining--; nextRemaining--; return { text, kind: 'context', old: String(old++), next: String(next++) }; }
    return { text, kind: 'meta', old: '', next: '' };
  });
}

export function pairDiffLines(lines: DiffLine[]): DiffPair[] {
  const pairs: DiffPair[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.kind !== 'remove' && line.kind !== 'add') { pairs.push({ left: line, right: line }); index++; continue; }
    const removed: DiffLine[] = []; const added: DiffLine[] = [];
    while (index < lines.length && (lines[index].kind === 'remove' || lines[index].kind === 'add')) {
      const change = lines[index++]; (change.kind === 'remove' ? removed : added).push(change);
    }
    for (let change = 0; change < Math.max(removed.length, added.length); change++) pairs.push({ left: removed[change], right: added[change] });
  }
  return pairs;
}
