import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import SplitIcon from "@hugeicons/core-free-icons/SplitIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { RunningLocation } from "@src/config/sessionCreatorConfig";

export const LOCATION_ICONS: Record<RunningLocation, React.ReactNode> = {
  local: (
    <HugeiconsIcon
      icon={LaptopIcon}
      data-icon="laptop"
      size={14}
      strokeWidth={1.75}
      className="text-text-1"
    />
  ),
  worktree: (
    <HugeiconsIcon
      icon={SplitIcon}
      data-icon="split"
      size={14}
      strokeWidth={1.75}
      className="rotate-90 text-text-1"
    />
  ),
  cloud: (
    <HugeiconsIcon
      icon={CloudIcon}
      data-icon="cloud"
      size={14}
      strokeWidth={1.75}
      className="text-text-1"
    />
  ),
};

export type LocationRow = { id: RunningLocation; disabled: boolean };
