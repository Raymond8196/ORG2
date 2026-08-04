export const GITHUB_WORK_ITEMS_SINGLE_ROW_MIN_WIDTH = 650;

export function shouldUseSingleRowGitHubWorkItemsHeader(
  containerWidth: number
): boolean {
  return containerWidth >= GITHUB_WORK_ITEMS_SINGLE_ROW_MIN_WIDTH;
}
