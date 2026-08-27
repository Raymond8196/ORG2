import Cloud from "@hugeicons/core-free-icons/CloudIcon";
import Laptop from "@hugeicons/core-free-icons/LaptopIcon";
import Split from "@hugeicons/core-free-icons/SplitIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { RunningLocation } from "@src/config/sessionCreatorConfig";

export const LOCATION_ICONS: Record<RunningLocation, React.ReactNode> = {
  local: (
    <HugeiconsIcon
      icon={Laptop}
      data-icon="laptop"
      size={14}
      strokeWidth={1.75}
      className="text-text-1"
    />
  ),
  worktree: (
    <HugeiconsIcon
      icon={Split}
      data-icon="split"
      size={14}
      strokeWidth={1.75}
      className="rotate-90 text-text-1"
    />
  ),
  cloud: (
    <HugeiconsIcon
      icon={Cloud}
      data-icon="cloud"
      size={14}
      strokeWidth={1.75}
      className="text-text-1"
    />
  ),
};

export type LocationRow = { id: RunningLocation; disabled: boolean };
