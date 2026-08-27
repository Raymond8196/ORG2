import Bot from "@hugeicons/core-free-icons/BotIcon";
import Cpu from "@hugeicons/core-free-icons/CpuIcon";
import Zap from "@hugeicons/core-free-icons/FlashIcon";
import Toolbox from "@hugeicons/core-free-icons/ToolboxIcon";
import Wrench from "@hugeicons/core-free-icons/Wrench01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { SlashItemCategory } from "@src/types/extensions";

export const FLYOUT_CATEGORIES = new Set<SlashItemCategory>(["skill", "tool"]);

export const CATEGORY_ORDER: SlashItemCategory[] = ["skill", "action", "tool"];

export const CATEGORY_LABELS: Record<SlashItemCategory, string> = {
  skill: "Skills",
  action: "Actions",
  tool: "MCP Servers",
};

export const MODE_FLYOUT_LABEL = "Mode";
export const MODELS_FLYOUT_LABEL = "Models";

export const ModeIcon = Bot as React.ComponentType<Record<string, unknown>>;
export const ModelsIcon = Cpu as React.ComponentType<Record<string, unknown>>;

export function categoryIcon(
  category: SlashItemCategory
): React.ComponentType<Record<string, unknown>> {
  switch (category) {
    case "skill":
      return Toolbox as React.ComponentType<Record<string, unknown>>;
    case "action":
      return Zap as React.ComponentType<Record<string, unknown>>;
    case "tool":
      return Wrench as React.ComponentType<Record<string, unknown>>;
  }
}
