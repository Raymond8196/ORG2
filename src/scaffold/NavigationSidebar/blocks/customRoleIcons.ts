/**
 * Curated icon palette for custom presence roles.
 *
 * Stored as a string id (`CustomRoleIconId`) in user data so the
 * persisted shape doesn't carry a component reference. Every visual
 * surface that needs to render the icon (presence pill, dropdown menu,
 * Settings → My Role list, role editor) resolves the glyph
 * through `resolveCustomRoleIcon`.
 */
import Book01Icon from "@hugeicons/core-free-icons/Book01Icon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Coffee01Icon from "@hugeicons/core-free-icons/Coffee01Icon";
import CompassIcon from "@hugeicons/core-free-icons/CompassIcon";
import FeatherIcon from "@hugeicons/core-free-icons/FeatherIcon";
import FireIcon from "@hugeicons/core-free-icons/FireIcon";
import HeadphonesIcon from "@hugeicons/core-free-icons/HeadphonesIcon";
import RocketIcon from "@hugeicons/core-free-icons/RocketIcon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import type { IconSvgElement } from "@hugeicons/react";

import type { CustomRoleIconId } from "@src/types/userPresence";

export const CUSTOM_ROLE_ICONS: Record<CustomRoleIconId, IconSvgElement> = {
  user: UserIcon,
  briefcase: Briefcase01Icon,
  code: CodeIcon,
  rocket: RocketIcon,
  coffee: Coffee01Icon,
  headphones: HeadphonesIcon,
  book: Book01Icon,
  compass: CompassIcon,
  feather: FeatherIcon,
  flame: FireIcon,
  shield: Shield01Icon,
  sparkles: SparklesIcon,
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
  return CUSTOM_ROLE_ICONS[id] ?? UserIcon;
}
