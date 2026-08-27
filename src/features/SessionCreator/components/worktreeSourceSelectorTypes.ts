import { type IconSvgElement } from "@hugeicons/react";

import type { WorktreeLaunchSource } from "@src/store/session/worktreeLaunchSourceAtom";

type LucideIcon = IconSvgElement;

export type WorktreeSourcePickerMode = "branch" | "pr";

export interface WorktreeSourcePickerItem {
  id: string;
  label: string;
  detail?: string;
  meta?: string;
  icon: LucideIcon;
  source: WorktreeLaunchSource;
  resolveMeta?: {
    prNumber: number;
    headBranch?: string;
    baseBranch?: string;
  };
}

export interface WorktreeSourcePickerSection {
  key: string;
  label?: string;
  items: WorktreeSourcePickerItem[];
}
