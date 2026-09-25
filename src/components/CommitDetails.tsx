import { Copy, FolderGit2, GitBranch, GitCommitHorizontal, UserRound } from 'lucide-react';
import type { CommitDetail } from '../../shared/types';
import { useI18n, useLocaleDate } from '../lib/i18n';

export default function CommitDetails({ detail, root, onBranch, onCopy }: {
  detail: CommitDetail; root: string; onBranch: (branch: string) => void; onCopy: (hash: string) => void;
}) {
  const { t } = useI18n();
  const format = useLocaleDate();
  const exactDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : `${format(value, { hour12: false })} (${value})`;
  };
  const commit = detail.commit;
  const fullMessage = (detail.body || '').trim();
  const description = fullMessage.startsWith(commit.subject) ? fullMessage.slice(commit.subject.length).trim() : fullMessage;
  return <section className="commit-information" aria-label={t('完整提交详情')}>
    <div className="commit-information-heading"><GitCommitHorizontal size={14} /><strong>{commit.subject}</strong><button className="icon-button" aria-label={t('复制完整提交哈希')} title={t('复制完整提交哈希')} onClick={() => onCopy(commit.hash)}><Copy size={13} /></button></div>
    {description && <pre className="commit-message-body">{description}</pre>}
    <dl className="commit-metadata">
      <dt>{t('提交列')}</dt><dd className="metadata-hash">{commit.hash}</dd>
      <dt><UserRound size={11} />{t('作者')}</dt><dd>{commit.author} &lt;{commit.email}&gt;</dd>
      <dt>{t('创作时间')}</dt><dd>{exactDate(commit.date)}</dd>
      <dt>{t('提交者')}</dt><dd>{commit.committer || commit.author} &lt;{commit.committerEmail || commit.email}&gt;</dd>
      <dt>{t('提交时间')}</dt><dd>{exactDate(commit.committedDate || commit.date)}</dd>
      <dt><FolderGit2 size={11} />{t('仓库')}</dt><dd title={root}>{root}</dd>
      <dt>{t('父提交')}</dt><dd className="metadata-hash">{commit.parents.length ? commit.parents.map(parent => <span key={parent}>{parent}</span>) : t('根提交')}</dd>
    </dl>
    <div className="containing-branches"><span><GitBranch size={12} />{t('包含此提交的分支')}</span><div>{detail.branches?.length ? detail.branches.map(branch => <button key={branch} onClick={() => onBranch(branch)} title={t('仅显示该分支的历史')}><GitBranch size={11} />{branch}</button>) : <small>{t('没有本地或远端跟踪分支包含此提交')}</small>}</div></div>
  </section>;
}
