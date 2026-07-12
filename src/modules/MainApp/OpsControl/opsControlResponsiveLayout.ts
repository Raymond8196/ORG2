export const OPS_CONTROL_MIN_MAIN_CONTENT_WIDTH_PX = 360;

export function shouldAutoCollapseOpsControlSidebar({
  surfaceWidth,
  sidebarWidth,
}: {
  surfaceWidth: number;
  sidebarWidth: number;
}): boolean {
  if (surfaceWidth <= 0) return false;
  return surfaceWidth - sidebarWidth < OPS_CONTROL_MIN_MAIN_CONTENT_WIDTH_PX;
}
