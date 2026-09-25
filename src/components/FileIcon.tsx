import type { CSSProperties } from 'react';
import { memo } from 'react';
import { Binary, CodeXml, Coffee, Database, File, FileArchive, FileCode2, FileJson, FileText, GitBranch, Image, Palette, Settings2, Terminal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { filePresentation } from '../lib/file-presentation';
import type { FileKind } from '../lib/file-presentation';
import './file-icons.css';

const ICONS: Partial<Record<FileKind, LucideIcon>> = {
  java: Coffee, xml: CodeXml, json: FileJson, image: Image, style: Palette, html: CodeXml,
  sql: Database, shell: Terminal, archive: FileArchive, binary: Binary, text: FileText,
  config: Settings2, submodule: GitBranch, file: File,
};

export const FileIcon = memo(function FileIcon({ path, size = 14, submodule = false }: { path: string; size?: number; submodule?: boolean }) {
  const presentation = filePresentation(path, submodule);
  const Icon = ICONS[presentation.kind] || FileCode2;
  const pixels = Number.isFinite(size) ? Math.max(10, Math.min(24, size)) : 14;
  return <span className={`gv-file-icon gv-file-icon-${presentation.kind}${presentation.badge ? ' gv-file-icon-badge' : ''}`} data-file-kind={presentation.kind} title={presentation.label} aria-label={presentation.label} role="img" style={{ '--file-icon-size': `${pixels}px`, '--file-icon-font-size': `${Math.max(6, pixels * .56)}px` } as CSSProperties}>
    {presentation.badge ? <span aria-hidden="true">{presentation.badge}</span> : <Icon size={pixels} strokeWidth={1.7} aria-hidden="true" />}
  </span>;
});

export default FileIcon;
