import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Link, Loader2 } from 'lucide-react';
import type { WorkspaceDirectory } from '../../shared/types';
import FileIcon from './FileIcon';
import { useI18n } from '../lib/i18n';

type Props = { root: string; revision: number; selected?: string; onSelect: (path: string) => void; statuses: Map<string, string> };
function Directory({ root, revision, selected, onSelect, statuses, path = '', name = '', depth = -1 }: Props & { path?: string; name?: string; depth?: number }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(depth < 1);
  const [listing, setListing] = useState<WorkspaceDirectory>();
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { if (selected?.startsWith(path + '/')) setExpanded(true); }, [selected, path]);
  useEffect(() => {
    if (!expanded) return;
    let alive = true; setError('');
    window.gitvista.workspaceDirectory(root, path).then(value => { if (alive) setListing(value); }).catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [root, path, revision, expanded, retry]);
  const icon = expanded ? <FolderOpen size={14} className="tree-folder-icon" /> : <Folder size={14} className="tree-folder-icon" />;
  return <div>
    {path && <button className="tree-folder" title={path} aria-expanded={expanded} style={{ paddingLeft: 8 + depth * 13 }} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{icon}<span>{name}</span></button>}
    {expanded && <>
      {!listing && !error && <div className="workspace-tree-notice"><Loader2 size={12} className="spin" />{t('读取代码…')}</div>}
      {error && <button className="workspace-tree-notice multi-repo-error" onClick={() => setRetry(value => value + 1)} title={error}>{t('读取目录失败，点击重试')}</button>}
      {listing?.entries.map(entry => entry.type === 'directory'
        ? <Directory key={entry.path} root={root} revision={revision} selected={selected} onSelect={onSelect} statuses={statuses} path={entry.path} name={entry.name} depth={depth + 1} />
        : <button key={entry.path} className={`tree-file ${selected === entry.path ? 'active' : ''}`} data-workspace-file={entry.path} title={entry.type === 'link' ? `${entry.path} · ${t('符号链接不可预览')}` : entry.path} disabled={entry.type === 'link'} style={{ paddingLeft: 22 + (depth + 1) * 13, paddingRight: 9 }} onClick={() => onSelect(entry.path)}>{entry.type === 'link' ? <Link size={14} /> : <FileIcon path={entry.path} />}<span className="tree-file-name">{entry.name}</span><i>{statuses.get(entry.path)}</i></button>)}
      {listing?.truncated && <div className="workspace-tree-notice multi-warning">{t('此目录超过 10000 项，仅显示前 10000 项。')}</div>}
      {listing && !listing.entries.length && <div className="workspace-tree-notice">{t('空文件夹')}</div>}
    </>}
  </div>;
}
export default function WorkspaceFileTree(props: Props) {
  const { t } = useI18n();
  return <div className="file-tree" aria-label={t('父文件夹完整目录')}><div className="file-tree-contents"><Directory {...props} /></div></div>;
}
