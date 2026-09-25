import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import type { GitCommit, GitCommitFile } from '../../shared/types';
import type { PushDiffTarget } from './PushFileDiff';
import FileIcon from './FileIcon';
import { fileStatusClass } from '../lib/file-presentation';
import { useI18n } from '../lib/i18n';
import './push-review.css';

// Limit concurrent Git reads; commits outside the scroll viewport load on demand.
let running = 0;
const waiting: (() => void)[] = [];
async function readFiles(repo: string, hash: string, signal: AbortSignal): Promise<GitCommitFile[]> {
  await new Promise<void>(resolve => { waiting.push(resolve); drain(); });
  try { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); return await window.gitvista.query<GitCommitFile[]>(repo, { type: 'commitFiles', ref: hash }); }
  finally { running--; drain(); }
}
function drain() { while (running < 4 && waiting.length) { running++; waiting.shift()!(); } }

export default function PushCommitFiles({ repo, commit, disabled, onFile }: { repo: string; commit: GitCommit; disabled?: boolean; onFile: (target: PushDiffTarget) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true), [visible, setVisible] = useState(false), [retry, setRetry] = useState(0);
  const [files, setFiles] = useState<GitCommitFile[]>(), [error, setError] = useState('');
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '120px' });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true; const controller = new AbortController(); setFiles(undefined); setError('');
    readFiles(repo, commit.hash, controller.signal).then(value => { if (alive) setFiles(value); }).catch(cause => { if (alive) setError(String(cause)); });
    return () => { alive = false; controller.abort(); };
  }, [repo, commit.hash, visible, retry]);
  return <div className="push-commit-group" ref={element} data-push-commit={commit.hash} data-push-repository={repo}>
    <button type="button" className="push-commit-summary" aria-expanded={open} onClick={() => setOpen(value => !value)} title={`${commit.short} · ${commit.subject} · ${commit.author}`}>
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<code>{commit.short}</code><span>{commit.subject}</span><small>{files?.length ?? '…'}</small>
    </button>
    {open && <div className="push-commit-file-list">
      {error ? <button className="push-files-error" onClick={() => setRetry(value => value + 1)} title={error}><RefreshCw size={12} />{t('读取文件列表失败，点击重试')}</button>
        : !files ? <div className="push-files-loading"><Loader2 size={12} className="spin" />{t('读取提交文件…')}</div>
        : files.length ? files.map(file => <button type="button" className="push-file" key={file.path} data-push-file={file.path} disabled={disabled} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} onClick={() => onFile({ repo, path: file.path, oldPath: file.oldPath, ref: commit.hash, subject: commit.subject, source: 'commit' })}>
          <FileIcon path={file.path} size={14} /><span>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span><i className={fileStatusClass(file.status)}>{file.status.slice(0, 1)}</i>
        </button>) : <div className="push-files-loading">{t('此提交没有文件变更')}</div>}
    </div>}
  </div>;
}
