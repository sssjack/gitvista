import { memo, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import FileIcon from './FileIcon';
import { fileStatusClass } from '../lib/file-presentation';
import { useI18n } from '../lib/i18n';

type TreeFile = { path: string; status?: string; submodule?: boolean };
type TreeNode = { name: string; path: string; children: TreeNode[]; status?: string; submodule?: boolean };
type TreeControl = { collapsed: boolean; id: number };
type FolderState = { controlId?: number; collapsed?: boolean; overrides: Map<string, boolean> };

function buildFileTree(files: TreeFile[]): { roots: TreeNode[]; folders: Set<string> } {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  for (const file of files) {
    let nodes = roots;
    let nodePath = '';
    const parts = file.path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      nodePath = index === 0 ? name : `${nodePath}/${name}`;
      let node = byPath.get(nodePath);
      if (!node) {
        node = { name, path: nodePath, children: [] };
        byPath.set(nodePath, node);
        nodes.push(node);
      }
      if (index === parts.length - 1) { node.status = file.status || ' '; node.submodule = file.submodule; }
      nodes = node.children;
    }
  }
  const folders = new Set<string>();
  const levels = [roots];
  while (levels.length) {
    const nodes = levels.pop()!;
    nodes.sort((a, b) => Number(!!b.children.length) - Number(!!a.children.length) || a.name.localeCompare(b.name));
    for (const node of nodes) {
      if (node.children.length) { folders.add(node.path); levels.push(node.children); }
    }
  }
  return { roots, folders };
}

function usesControl(state: FolderState, control?: TreeControl): boolean {
  return state.controlId === control?.id && state.collapsed === control?.collapsed;
}

function folderClosed(state: FolderState, control: TreeControl | undefined, path: string): boolean {
  return (usesControl(state, control) ? state.overrides.get(path) : undefined) ?? !!control?.collapsed;
}

function reconcileFolders(state: FolderState, control: TreeControl | undefined, folders: Set<string>): FolderState {
  if (!usesControl(state, control)) return { controlId: control?.id, collapsed: control?.collapsed, overrides: new Map() };
  if ([...state.overrides.keys()].every(path => folders.has(path))) return state;
  return { ...state, overrides: new Map([...state.overrides].filter(([path]) => folders.has(path))) };
}

function FileTree({ files, selected, onSelect, control }: {
  files: TreeFile[]; selected?: string; onSelect: (path: string) => void; control?: TreeControl;
}) {
  const { t } = useI18n();
  const [closed, setClosed] = useState<FolderState>(() => ({ controlId: control?.id, collapsed: control?.collapsed, overrides: new Map() }));
  const tree = useMemo(() => buildFileTree(files), [files]);
  // 控制值直接参与渲染，新目录无需等 effect 才继承“折叠全部”的状态。
  useEffect(() => { setClosed(state => reconcileFolders(state, control, tree.folders)); }, [tree, control?.id, control?.collapsed]);
  const toggleFolder = (path: string) => setClosed(state => {
    const next = reconcileFolders(state, control, tree.folders);
    const overrides = new Map(next.overrides);
    overrides.set(path, !folderClosed(next, control, path));
    return { ...next, overrides };
  });
  const render = (nodes: TreeNode[], depth = 0): React.ReactNode => nodes.map(node => {
    if (node.children.length) {
      const isClosed = folderClosed(closed, control, node.path);
      const FolderIcon = isClosed ? Folder : FolderOpen;
      return <div key={node.path}><button className="tree-folder" title={node.path} aria-expanded={!isClosed} style={{ paddingLeft: 8 + depth * 13 }} onClick={() => toggleFolder(node.path)}>{isClosed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}<FolderIcon className="tree-folder-icon" size={14} /><span>{node.name}</span></button>{!isClosed && render(node.children, depth + 1)}</div>;
    }
    return <button className={`tree-file ${node.path === selected ? 'active' : ''} ${fileStatusClass(node.status)}`} title={node.submodule ? `${node.path}${t('（子模块）')}` : node.path} key={node.path} style={{ paddingLeft: 22 + depth * 13, paddingRight: 9 }} disabled={node.submodule} onClick={() => onSelect(node.path)}><FileIcon path={node.path} submodule={node.submodule} /><span className="tree-file-name">{node.name}</span><i>{node.submodule ? '↗' : node.status?.trim().slice(0, 1)}</i></button>;
  });
  return <div className="file-tree" aria-label={t('逐级文件目录')}><div className="file-tree-contents">{render(tree.roots)}</div></div>;
}

export default memo(FileTree);
