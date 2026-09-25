/** Lightweight lexical highlighting. Tokens preserve source text; no HTML is interpreted. */
export type SyntaxKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'type' | 'function' | 'annotation' | 'property' | 'constant' | 'tag';
export type SyntaxToken = { kind: SyntaxKind; text: string };
export type SyntaxLanguage = 'plain' | 'code' | 'javascript' | 'python' | 'shell' | 'sql' | 'markup' | 'css' | 'json' | 'yaml';
export interface SyntaxState { blockEnd?: string; quote?: string; previous?: string; declaration?: boolean }
export interface HighlightedCode { lines: SyntaxToken[][]; language: SyntaxLanguage; limited: boolean }

const KEYWORDS = new Set(('abstract as assert async await base break case catch class const continue debugger declare default def defer delete do elif else enum except export extends extern final finally fn for from func function get global goto if implements import in inline instanceof interface internal is lambda let match module namespace native new nonlocal of operator out override package params partial pass private protected public pub readonly record ref register repeat require return sealed select set sizeof static struct super switch synchronized template this throw throws trait transient try type typedef typeof union unsafe unsigned use using val var virtual void volatile when where while with yield').split(' '));
const TYPES = new Set(('boolean bool byte char decimal double dynamic float int integer long never object sbyte short signed string symbol uint ulong unknown ushort any bigint number NoneType str bytes list dict tuple set frozenset complex bool Self String Boolean Byte Character Double Float Integer Long Short Number Object Promise Array Map Set Optional List Collection Class Date BigDecimal BigInteger Throwable Exception Error').split(' '));
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'NULL']);
const DECLARATIONS = new Set(['class', 'interface', 'enum', 'struct', 'trait', 'record', 'type', 'typedef']);
const SQL_WORDS = new Set('select from where join inner outer left right full on group by order having limit offset insert into values update set delete create alter drop table index primary key foreign references not and or in is null as asc desc union all distinct exists case when then else end begin commit rollback returning with'.split(' '));
const WORD = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)(?:n|[fFdDlL])?/y;
const MAX_LINE = 32_000;
const MAX_HIGHLIGHT = 1_500_000;
const MAX_TOKENS = 160_000;

export function syntaxLanguage(filePath = ''): SyntaxLanguage {
  const name = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  const extension = name.split('.').pop();
  if (['txt', 'log', 'md', 'markdown', 'csv', 'lock'].includes(extension || '')) return 'plain';
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(extension || '')) return 'javascript';
  if (['py', 'pyw', 'rb'].includes(extension || '')) return 'python';
  if (['sh', 'bash', 'zsh', 'ps1', 'psm1'].includes(extension || '') || name === 'dockerfile' || name === '.gitignore') return 'shell';
  if (['sql'].includes(extension || '')) return 'sql';
  if (['html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'xhtml'].includes(extension || '')) return 'markup';
  if (['css', 'scss', 'sass', 'less'].includes(extension || '')) return 'css';
  if (['json', 'jsonc', 'json5'].includes(extension || '')) return 'json';
  if (['yaml', 'yml', 'toml', 'ini', 'properties'].includes(extension || '')) return 'yaml';
  return 'code';
}

function push(tokens: SyntaxToken[], kind: SyntaxKind, text: string) {
  if (!text) return;
  const previous = tokens.at(-1);
  if (previous?.kind === kind) previous.text += text;
  else tokens.push({ kind, text });
}

function quoteEnd(line: string, start: number, delimiter: string): number {
  for (let index = start; index < line.length; index++) {
    if (line[index] === '\\') { index++; continue; }
    if (line.startsWith(delimiter, index)) return index + delimiter.length;
  }
  return -1;
}

/** State is separate for each source stream, especially the two sides of a diff. */
export function tokenizeSyntaxLine(line: string, language: SyntaxLanguage, state: SyntaxState): SyntaxToken[] {
  if (language === 'plain') return line ? [{ kind: 'plain', text: line }] : [];
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    if (state.blockEnd) {
      const end = line.indexOf(state.blockEnd, index);
      const next = end < 0 ? line.length : end + state.blockEnd.length;
      push(tokens, 'comment', line.slice(index, next)); index = next;
      if (end >= 0) state.blockEnd = undefined;
      continue;
    }
    if (state.quote) {
      const end = quoteEnd(line, index, state.quote);
      const next = end < 0 ? line.length : end;
      push(tokens, 'string', line.slice(index, next)); index = next;
      if (end >= 0) { state.quote = undefined; state.previous = 'literal'; }
      continue;
    }
    const char = line[index];
    if (/\s/.test(char)) {
      const start = index++;
      while (index < line.length && /\s/.test(line[index])) index++;
      push(tokens, 'plain', line.slice(start, index)); continue;
    }
    if (line.startsWith('<!--', index) && (language === 'markup' || language === 'javascript')) {
      state.blockEnd = '-->'; push(tokens, 'comment', '<!--'); index += 4; continue;
    }
    if (line.startsWith('/*', index) && !['python', 'shell', 'yaml'].includes(language)) {
      state.blockEnd = '*/'; push(tokens, 'comment', '/*'); index += 2; continue;
    }
    if ((line.startsWith('//', index) && !['python', 'shell', 'yaml', 'sql'].includes(language))
      || (char === '#' && ['python', 'shell', 'yaml'].includes(language))
      || (line.startsWith('--', index) && language === 'sql')) {
      push(tokens, 'comment', line.slice(index)); break;
    }
    if (char === '"' || char === "'" || (char === '`' && language !== 'python')) {
      const triple = language !== 'json' && char !== '`' && line.startsWith(char.repeat(3), index);
      const delimiter = triple ? char.repeat(3) : char;
      const end = quoteEnd(line, index + delimiter.length, delimiter);
      const next = end < 0 ? line.length : end;
      let kind: SyntaxKind = 'string';
      if (language === 'json' && end >= 0 && /^\s*:/.test(line.slice(end))) kind = 'property';
      push(tokens, kind, line.slice(index, next)); index = next;
      if (end < 0 && (triple || char === '`' || language === 'sql' || language === 'shell' || /\\$/.test(line))) state.quote = delimiter;
      state.previous = 'literal'; continue;
    }
    if (char === '/' && language === 'javascript' && (!state.previous || /^(?:=|\(|\[|,|:|!|\?|return|=>)$/.test(state.previous))) {
      let cursor = index + 1; let characterClass = false; let end = -1;
      for (; cursor < line.length; cursor++) {
        if (line[cursor] === '\\') { cursor++; continue; }
        if (line[cursor] === '[') characterClass = true;
        else if (line[cursor] === ']') characterClass = false;
        else if (line[cursor] === '/' && !characterClass) { end = cursor + 1; break; }
      }
      if (end >= 0) {
        while (/[a-z]/i.test(line[end] || '') && end < line.length) end++;
        push(tokens, 'string', line.slice(index, end)); index = end; state.previous = 'literal'; continue;
      }
    }
    if (char === '@' && language !== 'css') {
      WORD.lastIndex = index + 1; const name = WORD.exec(line);
      if (name) {
        let end = WORD.lastIndex;
        while (line[end] === '.') { WORD.lastIndex = end + 1; if (!WORD.exec(line)) break; end = WORD.lastIndex; }
        push(tokens, 'annotation', line.slice(index, end)); index = end; state.previous = '@'; continue;
      }
    }
    if (char === '<' && (language === 'markup' || language === 'javascript') && /^<\/?[A-Za-z]/.test(line.slice(index))) {
      const match = /^<\/?[\w:.-]+/.exec(line.slice(index))!;
      push(tokens, 'tag', match[0]); index += match[0].length; state.previous = '<tag'; continue;
    }
    if (/\d/.test(char)) {
      NUMBER.lastIndex = index; const match = NUMBER.exec(line);
      if (match) { push(tokens, 'number', match[0]); index = NUMBER.lastIndex; state.previous = 'literal'; continue; }
    }
    WORD.lastIndex = index; const match = WORD.exec(line);
    if (match) {
      const word = match[0]; const end = WORD.lastIndex;
      let next = end; while (next < line.length && /\s/.test(line[next])) next++;
      let kind: SyntaxKind = 'plain';
      if (line[next] === '(' && state.previous === '.') kind = 'function';
      else if (KEYWORDS.has(word) || (language === 'sql' && SQL_WORDS.has(word.toLowerCase()))) kind = 'keyword';
      else if (LITERALS.has(word)) kind = 'constant';
      else if (state.declaration || TYPES.has(word) || /^[A-Z][\p{L}\p{N}_$]*$/u.test(word) && !/^[A-Z\d_]+$/.test(word)) kind = 'type';
      else if (line[next] === '(' || /^(?:function|def|fn|func)$/.test(state.previous || '') || /^\s*=\s*(?:\([^)]{0,200}\)|[\w$]+)\s*=>/.test(line.slice(end, end + 240))) kind = 'function';
      else if (/^[A-Z][A-Z\d_]+$/.test(word)) kind = 'constant';
      else if (state.previous === '.' || line[next] === ':' || (language === 'markup' && line[next] === '=')) kind = 'property';
      push(tokens, kind, word); index = end;
      state.declaration = DECLARATIONS.has(word); state.previous = word; continue;
    }
    if (line.startsWith('=>', index)) { push(tokens, 'plain', '=>'); index += 2; state.previous = '=>'; continue; }
    push(tokens, 'plain', char); index++; state.previous = char;
    if (!'.<>,[]?'.includes(char)) state.declaration = false;
  }
  return tokens;
}

/** Bound expensive tokenization, while always retaining every source line verbatim. */
export function highlightCode(text: string, filePath?: string): HighlightedCode {
  const language = syntaxLanguage(filePath); const state: SyntaxState = {};
  let characters = 0; let tokens = 0; let limited = false;
  const lines = text.split('\n').map(raw => {
    const line = raw.replace(/\r$/, ''); characters += line.length;
    if (line.length > MAX_LINE || characters > MAX_HIGHLIGHT || tokens > MAX_TOKENS) {
      limited = true; state.blockEnd = undefined; state.quote = undefined; state.previous = undefined; state.declaration = undefined;
      return line ? [{ kind: 'plain' as const, text: line }] : [];
    }
    const result = tokenizeSyntaxLine(line, language, state); tokens += result.length; return result;
  });
  return { lines, language, limited };
}
