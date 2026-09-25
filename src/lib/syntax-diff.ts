import type { DiffLine } from './diff-lines';
import { syntaxLanguage, tokenizeSyntaxLine, type SyntaxState, type SyntaxToken } from './syntax';

export interface DiffSyntax { left?: SyntaxToken[]; right?: SyntaxToken[] }

function headerPath(value: string): string | undefined {
  let result = value;
  if (result.startsWith('"')) { try { result = JSON.parse(result) as string; } catch { return undefined; } }
  if (result === '/dev/null') return undefined;
  return result.replace(/^[ab]\//, '');
}

/** Old/new lexical states must never leak across an inserted or removed comment delimiter. */
export function highlightDiffLines(lines: DiffLine[], filePath?: string): { tokens: Map<DiffLine, DiffSyntax>; limited: boolean } {
  const tokens = new Map<DiffLine, DiffSyntax>();
  let left: SyntaxState = {}; let right: SyntaxState = {};
  let leftLanguage = syntaxLanguage(filePath); let rightLanguage = leftLanguage;
  let characters = 0; let tokenCount = 0; let limited = false;
  const highlight = (line: string, side: 'left' | 'right') => {
    characters += line.length;
    if (line.length > 32_000 || characters > 1_500_000 || tokenCount > 160_000) {
      limited = true;
      if (side === 'left') left = {}; else right = {};
      return line ? [{ kind: 'plain' as const, text: line }] : [];
    }
    const result = tokenizeSyntaxLine(line, side === 'left' ? leftLanguage : rightLanguage, side === 'left' ? left : right);
    tokenCount += result.length; return result;
  };
  for (const row of lines) {
    if (row.kind === 'meta') {
      if (row.text.startsWith('diff --git ')) { left = {}; right = {}; leftLanguage = syntaxLanguage(filePath); rightLanguage = leftLanguage; }
      if (row.text.startsWith('--- ')) { const source = headerPath(row.text.slice(4)); if (source) leftLanguage = syntaxLanguage(source); }
      if (row.text.startsWith('+++ ')) { const source = headerPath(row.text.slice(4)); if (source) rightLanguage = syntaxLanguage(source); }
      continue;
    }
    if (row.kind === 'hunk') { left = {}; right = {}; continue; }
    const content = row.text.slice(1).replace(/\r$/, '');
    tokens.set(row, {
      left: row.kind !== 'add' ? highlight(content, 'left') : undefined,
      right: row.kind !== 'remove' ? highlight(content, 'right') : undefined,
    });
  }
  return { tokens, limited };
}
