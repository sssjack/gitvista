export type FileKind = 'java' | 'javascript' | 'typescript' | 'jsx' | 'tsx' | 'vue' | 'xml' | 'maven' | 'json' | 'yaml' | 'markdown' | 'image' | 'style' | 'html' | 'python' | 'sql' | 'shell' | 'archive' | 'binary' | 'text' | 'config' | 'submodule' | 'file';
export type FilePresentation = { kind: FileKind; label: string; badge?: string };

const PRESENTATIONS: Record<FileKind, FilePresentation> = {
  java: { kind: 'java', label: 'Java 文件' },
  javascript: { kind: 'javascript', label: 'JavaScript 文件', badge: 'JS' },
  typescript: { kind: 'typescript', label: 'TypeScript 文件', badge: 'TS' },
  jsx: { kind: 'jsx', label: 'JavaScript JSX 文件', badge: 'JS' },
  tsx: { kind: 'tsx', label: 'TypeScript JSX 文件', badge: 'TS' },
  vue: { kind: 'vue', label: 'Vue 文件', badge: 'V' },
  xml: { kind: 'xml', label: 'XML 文件' },
  maven: { kind: 'maven', label: 'Maven 项目配置', badge: 'm' },
  json: { kind: 'json', label: 'JSON 文件' },
  yaml: { kind: 'yaml', label: 'YAML 文件', badge: 'Y' },
  markdown: { kind: 'markdown', label: 'Markdown 文件', badge: 'MD' },
  image: { kind: 'image', label: '图片文件' },
  style: { kind: 'style', label: '样式文件' },
  html: { kind: 'html', label: 'HTML 文件' },
  python: { kind: 'python', label: 'Python 文件', badge: 'Py' },
  sql: { kind: 'sql', label: 'SQL 文件' },
  shell: { kind: 'shell', label: '脚本文件' },
  archive: { kind: 'archive', label: '归档文件' },
  binary: { kind: 'binary', label: '二进制文件' },
  text: { kind: 'text', label: '文本文件' },
  config: { kind: 'config', label: '配置文件' },
  submodule: { kind: 'submodule', label: 'Git 子模块' },
  file: { kind: 'file', label: '文件' },
};

const EXTENSIONS = new Map<string, FileKind>([
  ['java', 'java'], ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'], ['jsx', 'jsx'],
  ['ts', 'typescript'], ['mts', 'typescript'], ['cts', 'typescript'], ['tsx', 'tsx'], ['vue', 'vue'],
  ['xml', 'xml'], ['xsd', 'xml'], ['xsl', 'xml'], ['json', 'json'], ['jsonc', 'json'], ['json5', 'json'],
  ['yaml', 'yaml'], ['yml', 'yaml'], ['md', 'markdown'], ['mdx', 'markdown'], ['markdown', 'markdown'],
  ['png', 'image'], ['jpg', 'image'], ['jpeg', 'image'], ['gif', 'image'], ['svg', 'image'], ['webp', 'image'], ['ico', 'image'], ['bmp', 'image'], ['avif', 'image'],
  ['css', 'style'], ['scss', 'style'], ['sass', 'style'], ['less', 'style'], ['html', 'html'], ['htm', 'html'],
  ['py', 'python'], ['pyw', 'python'], ['sql', 'sql'], ['sh', 'shell'], ['bash', 'shell'], ['zsh', 'shell'], ['ps1', 'shell'], ['bat', 'shell'], ['cmd', 'shell'],
  ['zip', 'archive'], ['7z', 'archive'], ['rar', 'archive'], ['gz', 'archive'], ['tar', 'archive'], ['jar', 'archive'], ['war', 'archive'],
  ['exe', 'binary'], ['dll', 'binary'], ['bin', 'binary'], ['class', 'binary'], ['wasm', 'binary'],
  ['txt', 'text'], ['log', 'text'], ['csv', 'text'], ['properties', 'config'], ['toml', 'config'], ['ini', 'config'], ['conf', 'config'],
]);

export function filePresentation(path: string, submodule = false): FilePresentation {
  if (submodule) return PRESENTATIONS.submodule;
  const name = path.split(/[\\/]/).pop()?.toLowerCase() || '';
  if (name === 'pom.xml') return PRESENTATIONS.maven;
  if (['.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.env', 'dockerfile', 'makefile'].includes(name) || name.startsWith('.env.')) return PRESENTATIONS.config;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return PRESENTATIONS[EXTENSIONS.get(extension) || 'file'];
}

export function fileStatusClass(status?: string): string {
  const value = status?.trim().toUpperCase() || '';
  if (!value || value === '!!') return '';
  if (value === 'U' || ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(value)) return 'git-file-status git-file-conflict';
  if (value.includes('D')) return 'git-file-status git-file-deleted';
  if (value.startsWith('A') || value.includes('?')) return 'git-file-status git-file-added';
  if (/^[MRCT]/.test(value)) return 'git-file-status git-file-modified';
  return '';
}
