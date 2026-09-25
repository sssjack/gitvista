import type { GitCommit } from '../../shared/types';

export interface GraphPoint { x: number; y: number }
export interface CommitGraphNode extends GraphPoint {
  hash: string;
  row: number;
  lane: number;
  color: number;
  parentHashes: string[];
  isMerge: boolean;
}
export interface CommitGraphEdge {
  id: string;
  childHash: string;
  parentHash: string;
  parentIndex: number;
  color: number;
  path: string;
  from: GraphPoint;
  to: GraphPoint;
  routeLane: number;
  missingParent: boolean;
  reverse: boolean;
}
export interface CommitGraphLayout {
  width: number;
  height: number;
  laneCount: number;
  nodes: CommitGraphNode[];
  edges: CommitGraphEdge[];
}
export interface CommitGraphOptions {
  rowHeight?: number;
  laneWidth?: number;
  padding?: number;
  /** 未过滤、可继续分页的历史可保留边界轨道，使追加页面时已有节点位置不变。 */
  reserveMissingParents?: boolean;
}

type GraphCommit = Pick<GitCommit, 'hash' | 'parents'>;
type Reservation = { lane: number; color: number };
type RoutedEdge = CommitGraphEdge & { childRow: number; parentRow: number };
const number = (value: number) => Math.round(value * 1000) / 1000;
const point = ({ x, y }: GraphPoint) => `${number(x)} ${number(y)}`;

/**
 * 按真实父提交关系布置整张日志图，不用相邻行位置猜测连线。
 *
 * 向下的父轨道一直保留到该父提交出现，因此中间的其他提交不会占用它；
 * 日期排序导致父提交出现在上方时，额外使用图右侧的回连轨道。
 * 输出整张 SVG 的绝对坐标，避免逐行 SVG 裁剪造成断线。
 */
export function buildCommitGraph(
  commits: readonly GraphCommit[], options: CommitGraphOptions = {},
): CommitGraphLayout {
  const rowHeight = positive(options.rowHeight, 34, 16);
  const laneWidth = positive(options.laneWidth, 18, 12);
  const padding = positive(options.padding, 8, 0);
  const x = (lane: number) => padding + laneWidth * (lane + 0.5);
  const y = (row: number) => rowHeight * (row + 0.5);
  const rows = new Map(commits.map((commit, row) => [commit.hash, row]));
  const reservations = new Map<string, Reservation>();
  const occupied = new Map<number, string>();
  const nodes: CommitGraphNode[] = [];
  const nodesByHash = new Map<string, CommitGraphNode>();
  const routed: RoutedEdge[] = [];
  let nextColor = 0;
  let highestLane = -1;

  const freeLane = (taken: ReadonlySet<number> = new Set()) => {
    let lane = 0;
    while (occupied.has(lane) || taken.has(lane)) lane += 1;
    return lane;
  };
  const reserve = (hash: string, lane: number, color: number): Reservation => {
    const reservation = { lane, color };
    reservations.set(hash, reservation);
    occupied.set(lane, hash);
    highestLane = Math.max(highestLane, lane);
    return reservation;
  };

  for (const [row, commit] of commits.entries()) {
    const existing = reservations.get(commit.hash);
    const lane = existing?.lane ?? freeLane();
    const color = existing?.color ?? nextColor++;
    if (existing) {
      reservations.delete(commit.hash);
      occupied.delete(lane);
    }
    const parentHashes = [...new Set(commit.parents)].filter(hash => hash && hash !== commit.hash);
    const node: CommitGraphNode = {
      hash: commit.hash, row, lane, x: x(lane), y: y(row), color,
      parentHashes, isMerge: parentHashes.length > 1,
    };
    nodes.push(node);
    nodesByHash.set(commit.hash, node);
    highestLane = Math.max(highestLane, lane);
    // 同一行的多个分叉和边界短线使用独立轨道。
    const rowTaken = new Set([lane]);

    for (const [parentIndex, parentHash] of parentHashes.entries()) {
      const parentRow = rows.get(parentHash);
      const missingParent = parentRow === undefined;
      const reverse = parentRow !== undefined && parentRow < row;
      let target: Reservation;
      if (reverse) {
        const parentNode = nodesByHash.get(parentHash)!;
        target = { lane: parentNode.lane, color: parentNode.color };
      } else {
        const pending = reservations.get(parentHash);
        if (pending) {
          target = pending;
        } else {
          const targetLane = parentIndex === 0 ? lane : freeLane(rowTaken);
          const targetColor = parentIndex === 0 ? color : nextColor++;
          target = !missingParent || options.reserveMissingParents
            ? reserve(parentHash, targetLane, targetColor)
            : { lane: targetLane, color: targetColor };
        }
        rowTaken.add(target.lane);
        highestLane = Math.max(highestLane, target.lane);
      }
      const from = { x: node.x, y: node.y };
      const to = {
        x: x(target.lane),
        y: missingParent ? node.y + Math.min(rowHeight * 0.42, rowHeight / 2 - 3) : y(parentRow),
      };
      routed.push({
        id: `${commit.hash}:${parentIndex}:${parentHash}`,
        childHash: commit.hash, parentHash, parentIndex,
        color: target.color, from, to, routeLane: target.lane,
        missingParent, reverse, path: '', childRow: row, parentRow: parentRow ?? row,
      });
    }
  }

  // 日期顺序不保证拓扑顺序。回连在普通轨道之外绕行，不穿过中间的提交节点。
  const reverseBaseLane = highestLane + 1;
  const reverseChannelEnds: number[] = [];
  const reverseEdges = routed.filter(edge => edge.reverse)
    .sort((a, b) => a.parentRow - b.parentRow || a.childRow - b.childRow || a.parentIndex - b.parentIndex);
  for (const edge of reverseEdges) {
    let channel = reverseChannelEnds.findIndex(end => end < edge.parentRow);
    if (channel === -1) channel = reverseChannelEnds.length;
    reverseChannelEnds[channel] = edge.childRow;
    edge.routeLane = reverseBaseLane + channel;
    highestLane = Math.max(highestLane, edge.routeLane);
  }

  const edges = routed.map(({ childRow: _childRow, parentRow: _parentRow, ...edge }) => {
    edge.path = edge.reverse
      ? reversePath(edge.from, edge.to, x(edge.routeLane), rowHeight / 2)
      : forwardPath(edge.from, edge.to, Math.min(rowHeight / 2, edge.to.y - edge.from.y));
    return edge;
  });
  const laneCount = Math.max(1, highestLane + 1);
  return { width: padding * 2 + laneCount * laneWidth, height: commits.length * rowHeight, laneCount, nodes, edges };
}

function forwardPath(from: GraphPoint, to: GraphPoint, bendHeight: number): string {
  if (from.x === to.x) return `M ${point(from)} L ${point(to)}`;
  const bend = from.y + bendHeight;
  return `M ${point(from)} C ${point({ x: from.x, y: bend })}, ${point({ x: to.x, y: from.y })}, ${point({ x: to.x, y: bend })} L ${point(to)}`;
}

function reversePath(from: GraphPoint, to: GraphPoint, routeX: number, bendHeight: number): string {
  const startY = from.y - bendHeight;
  const endY = to.y + bendHeight;
  return `M ${point(from)} C ${point({ x: from.x, y: startY })}, ${point({ x: routeX, y: from.y })}, ${point({ x: routeX, y: startY })} L ${point({ x: routeX, y: endY })} C ${point({ x: routeX, y: to.y })}, ${point({ x: to.x, y: endY })}, ${point(to)}`;
}

function positive(value: number | undefined, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : fallback;
}
