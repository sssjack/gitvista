import { useState } from 'react';
import type { GitCommit } from '../../shared/types';
import type { CommitGraphLayout } from '../lib/commit-graph';

const color = (index: number) => `var(--graph-${index % 6})`;

export default function CommitGraph({ graph, commits, selected, disabled, onSelect, onParent, onContext }: {
  graph: CommitGraphLayout; commits: GitCommit[]; selected?: string; disabled: boolean;
  onSelect: (hash: string) => void; onParent: (hash: string, missing: boolean) => void;
  onContext: (hash: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const byHash = new Map(commits.map(commit => [commit.hash, commit]));
  const activate = (event: React.KeyboardEvent<SVGGElement>, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!disabled) action(); }
  };
  const label = (hash: string) => `${hash.slice(0, 8)} ${byHash.get(hash)?.subject || ''}`.trim();
  return <svg className="interactive-commit-graph" width={graph.width} height={graph.height}
    viewBox={`0 0 ${graph.width} ${Math.max(1, graph.height)}`} role="group" aria-label="可交互提交关系图">
    {graph.edges.map(edge => {
      const active = hovered === edge.id || hovered === edge.childHash || hovered === edge.parentHash;
      const related = selected === edge.childHash || selected === edge.parentHash;
      const description = `${label(edge.childHash)} → 父提交 ${label(edge.parentHash)}${edge.missingParent ? '（当前列表外，点击定位并显示其历史）' : '（点击跳转）'}`;
      return <g key={edge.id} className={`graph-edge ${active ? 'hovered' : ''} ${related ? 'related' : ''}`}
        style={{ color: color(edge.color) }} data-graph-edge={edge.id} data-child={edge.childHash} data-parent={edge.parentHash} data-missing={edge.missingParent}
        role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={description}
        onMouseEnter={() => setHovered(edge.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(edge.id)} onBlur={() => setHovered(null)}
        onContextMenu={event => { event.preventDefault(); if (!disabled) onContext(edge.childHash); }}
        onClick={() => { if (!disabled) onParent(edge.parentHash, edge.missingParent); }} onKeyDown={event => activate(event, () => onParent(edge.parentHash, edge.missingParent))}>
        <title>{description}</title>
        <path className="graph-edge-halo" d={edge.path} />
        <path className="graph-edge-line" d={edge.path} strokeDasharray={edge.missingParent ? '3 4' : undefined} />
        <path className="graph-edge-hit" d={edge.path} />
      </g>;
    })}
    {graph.nodes.map(node => {
      const commit = byHash.get(node.hash)!;
      const merge = commit.parents.length > 1;
      const description = `${merge ? '合并提交' : '提交'} ${label(node.hash)}，点击查看文件和代码`;
      return <g key={node.hash} transform={`translate(${node.x} ${node.y})`} className={`graph-node ${selected === node.hash ? 'selected' : ''}`}
        style={{ color: color(node.color) }} data-graph-node={node.hash} data-merge={merge} role="button" tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled} aria-label={description} aria-pressed={selected === node.hash}
        onMouseEnter={() => setHovered(node.hash)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.hash)} onBlur={() => setHovered(null)}
        onContextMenu={event => { event.preventDefault(); if (!disabled) onContext(node.hash); }}
        onClick={() => { if (!disabled) onSelect(node.hash); }} onKeyDown={event => activate(event, () => onSelect(node.hash))}>
        <title>{description}</title>
        <circle className="graph-node-halo" r="9" />
        <circle className="graph-node-dot" r={merge ? 5.5 : 4} />
        {merge && <circle className="graph-merge-center" r="2" />}
        <circle className="graph-node-hit" r="10" />
      </g>;
    })}
  </svg>;
}
