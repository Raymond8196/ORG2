/**
 * Curated icon palette for custom presence roles.
 *
 * Stored as a string id (`CustomRoleIconId`) in user data so the
 * persisted shape doesn't carry a component reference. Every visual
 * surface that needs to render the icon (presence pill, dropdown menu,
 * Settings → My Role list, role editor) resolves the lucide component
 * through `resolveCustomRoleIcon`.
 */
import Book from "@hugeicons/core-free-icons/Book01Icon";
import Briefcase from "@hugeicons/core-free-icons/Briefcase01Icon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import Coffee from "@hugeicons/core-free-icons/Coffee01Icon";
import Compass from "@hugeicons/core-free-icons/CompassIcon";
import Feather from "@hugeicons/core-free-icons/FeatherIcon";
import Flame from "@hugeicons/core-free-icons/FireIcon";
import Headphones from "@hugeicons/core-free-icons/HeadphonesIcon";
import Rocket from "@hugeicons/core-free-icons/RocketIcon";
import Shield from "@hugeicons/core-free-icons/Shield01Icon";
import Sparkles from "@hugeicons/core-free-icons/SparklesIcon";
import User from "@hugeicons/core-free-icons/UserIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import type { CustomRoleIconId } from "@src/types/userPresence";

export const CUSTOM_ROLE_ICONS: Record<CustomRoleIconId, IconSvgElement> = {
  user: User,
  briefcase: Briefcase,
  code: Code,
  rocket: Rocket,
  coffee: Coffee,
  headphones: Headphones,
  book: Book,
  compass: Compass,
  feather: Feather,
  flame: Flame,
  shield: Shield,
  sparkles: Sparkles,
};

export const CUSTOM_ROLE_ICON_IDS: readonly CustomRoleIconId[] = [
  "user",
  "briefcase",
  "code",
  "rocket",
  "coffee",
  "headphones",
  "book",
  "compass",
  "feather",
  "flame",
  "shield",
  "sparkles",
] as const;

export function resolveCustomRoleIcon(id: CustomRoleIconId): IconSvgElement {
  return CUSTOM_ROLE_ICONS[id] ?? User;
}
