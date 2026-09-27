/** Per-view budgets. Paging changes the retained window, never the available history. */
export const RESOURCE_BUDGET = {
  historyPage: 250,
  fileHistoryPage: 100,
  historyBytes: 2 * 1024 * 1024,
  authorSuggestions: 250,
  workspaceBufferCommits: 500,
  workspaceCheckpoints: 8,
  textPageLines: 400,
  // JS strings use up to two bytes per UTF-16 unit. A single long line remains intact.
  textPageCharacters: 64 * 1024,
  overscan: 8,
} as const;

export function historyPageWithinBudget<T>(commits: T[], limit: number = RESOURCE_BUDGET.historyPage): T[] {
  let bytes = 0;
  return commits.slice(0, limit).filter((commit, index) => {
    bytes += JSON.stringify(commit).length * 2;
    return index === 0 || bytes <= RESOURCE_BUDGET.historyBytes;
  });
}
