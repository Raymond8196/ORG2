/**
 * Background Page Configuration
 * Contains all preset data for background customization
 */
import BambooBlueBg from "@src/assets/bg/bamboo-blue.jpg";
import BambooGreenBg from "@src/assets/bg/bamboo-green.jpg";
import MountainBlueBg from "@src/assets/bg/mountain-blue.jpg";
import MountainGreenBg from "@src/assets/bg/mountain-green.jpg";

import type { ImagePreset } from "./types";

// ═══════════════════════════════════════════════════════════════
// PRESET IMAGES
// ═══════════════════════════════════════════════════════════════

export const PRESET_IMAGES: ImagePreset[] = [
  {
    label: "Bamboo Blue",
    value: BambooBlueBg,
    thumbnail: BambooBlueBg,
  },
  {
    label: "Bamboo Green",
    value: BambooGreenBg,
    thumbnail: BambooGreenBg,
  },
  {
    label: "Mountain Blue",
    value: MountainBlueBg,
    thumbnail: MountainBlueBg,
  },
  {
    label: "Mountain Green",
    value: MountainGreenBg,
    thumbnail: MountainGreenBg,
  },
];

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Upper bound for DIY solid colors saved in background config */
export const MAX_CUSTOM_BACKGROUND_COLORS = 24;
