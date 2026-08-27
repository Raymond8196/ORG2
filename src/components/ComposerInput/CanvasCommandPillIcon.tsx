import Layout from "@hugeicons/core-free-icons/Layout01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React, { memo } from "react";

import { EDITOR_FILE_PILL_TEXT_COLOR, PILL_SIZE } from "@src/config/pillTokens";

export function isCanvasCommandPillPath(path: string): boolean {
  return path.trim().toLowerCase() === "/canvas";
}

const CanvasCommandPillIcon: React.FC = memo(() => (
  <HugeiconsIcon
    icon={Layout}
    data-icon="panels-top-left"
    size={PILL_SIZE.iconSize}
    strokeWidth={1.75}
    style={{ color: EDITOR_FILE_PILL_TEXT_COLOR }}
  />
));
CanvasCommandPillIcon.displayName = "CanvasCommandPillIcon";

export default CanvasCommandPillIcon;
