import { RESOURCE_BUDGET } from './resource-budget';

export interface TextPage { start: number; end: number; firstLine: number; lines: number; prefix: string }

/** Keep only offsets into the original string, not a second array/token tree for every line. */
export function indexTextPages(text: string, diff = false): TextPage[] {
  const pages: TextPage[] = [];
  let start = 0, firstLine = 1, count = 0, offset = 0, prefix = '';
  let header = '', old = 0, next = 0, oldRemaining = 0, nextRemaining = 0, inHunk = false;
  const continuation = () => header + (inHunk ? `@@ -${old},${oldRemaining} +${next},${nextRemaining} @@\n` : '');
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const end = newline < 0 ? text.length : newline + 1;
    if (count && (count >= RESOURCE_BUDGET.textPageLines || end - start > RESOURCE_BUDGET.textPageCharacters)) {
      pages.push({ start, end: offset, firstLine, lines: count, prefix });
      firstLine += count; start = offset; count = 0;
      prefix = diff && !/^diff --(?:git|cc|combined) /.test(text.slice(offset, offset + 24)) ? text.startsWith('@@ ', offset) ? header : continuation() : '';
    }
    if (diff) {
      const line = text.slice(offset, newline < 0 ? end : newline);
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (/^diff --(?:git|cc|combined) /.test(line)) { header = line + '\n'; inHunk = false; }
      else if (hunk) { old = Number(hunk[1]); next = Number(hunk[3]); oldRemaining = Number(hunk[2] ?? 1); nextRemaining = Number(hunk[4] ?? 1); inHunk = true; }
      else if (inHunk && line.startsWith('+') && nextRemaining > 0) { next++; nextRemaining--; }
      else if (inHunk && line.startsWith('-') && oldRemaining > 0) { old++; oldRemaining--; }
      else if (inHunk && line.startsWith(' ') && oldRemaining > 0 && nextRemaining > 0) { old++; next++; oldRemaining--; nextRemaining--; }
      else if (!inHunk && header.length + line.length < 16_384) header += line + '\n';
    }
    count++; offset = end;
  }
  // Source editors show the empty last line after a terminal newline; Git patches do not.
  if (!diff && (!text.length || text.endsWith('\n'))) {
    if (count >= RESOURCE_BUDGET.textPageLines) { pages.push({ start, end: text.length, firstLine, lines: count, prefix }); firstLine += count; start = text.length; count = 0; }
    count++;
  }
  if (count) pages.push({ start, end: text.length, firstLine, lines: count, prefix });
  return pages;
}

export function readTextPage(text: string, page: TextPage, diff = false): string {
  const value = text.slice(page.start, page.end);
  return page.prefix + (!diff && value.endsWith('\n') && value.split('\n').length > page.lines ? value.slice(0, -1) : value);
}
