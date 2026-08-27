/**
 * Agent Icon Registry
 *
 * Resolves agent icon ids to renderable icon sources:
 *
 * - Slug ids (from backend `iconId`) map to hugeicons glyph data
 *   (`IconSvgElement` arrays, rendered via `HugeiconsIcon`).
 * - Provider ids (claude, codex, cursor, …) resolve to brand-mark
 *   components via the `brandIcon` adapter (e.g. for Cursor IDE history
 *   rows).
 *
 * The backend contract is unchanged: `icon_id` values are still
 * Lucide-style kebab-case slugs (e.g. "omega", "code", "brain") — the
 * same convention as the tools system. Only the frontend rendering moved
 * to hugeicons.
 *
 * Because the registry hands out a mix of glyph data and components,
 * consumers must render the result through `AnyIcon` — see the
 * `AgentIconSource` doc comment below for the shape distinction.
 *
 * Only icons actually used by agents need to be registered here. When
 * adding a new agent in Rust, use an existing Lucide-style slug for
 * `icon_id` and add it here if not already present.
 */
import DraftingCompass from "@hugeicons/core-free-icons/AiGenerativeIcon";
import ClipboardList from "@hugeicons/core-free-icons/BookEditIcon";
import Bot from "@hugeicons/core-free-icons/BotIcon";
import Brain from "@hugeicons/core-free-icons/BrainIcon";
import ChartColumn from "@hugeicons/core-free-icons/ChartColumnIcon";
import Code from "@hugeicons/core-free-icons/CodeIcon";
import Terminal from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import MousePointerClick from "@hugeicons/core-free-icons/CursorPointer02Icon";
import Network from "@hugeicons/core-free-icons/HierarchyCircle01Icon";
import Monitor from "@hugeicons/core-free-icons/MonitorIcon";
import Sprout from "@hugeicons/core-free-icons/Plant01Icon";
import Omega from "@hugeicons/core-free-icons/RecordIcon";
import HandMetal from "@hugeicons/core-free-icons/Shaka01Icon";
import FlaskConical from "@hugeicons/core-free-icons/TestTubeIcon";
import User from "@hugeicons/core-free-icons/UserIcon";
import Users from "@hugeicons/core-free-icons/UserMultipleIcon";
import type { IconSvgElement } from "@hugeicons/react";
import React, { forwardRef } from "react";

import { type RenderableIcon } from "@src/components/AnyIcon";
import {
  type IconProvider,
  getIconComponent,
  getIconProviderFromType,
  isIconProvider,
} from "@src/components/ModelIcon/config";

/**
 * What the agent-icon registry actually hands out: hugeicons glyph data
 * for slug ids, or a brand-mark COMPONENT for provider ids (claude,
 * codex, …). The two shapes are NOT interchangeable — glyph data must be
 * rendered via `HugeiconsIcon`, components via JSX — so consumers must
 * render through `AnyIcon`, which dispatches on the runtime shape.
 * Never pass this union to `<HugeiconsIcon icon={…}>` directly: a brand
 * component crashes its internal `[...icon]` spread.
 */
export type AgentIconSource = RenderableIcon;

/**
 * Wrap a brand `<svg>` (React.FC<SVGProps>) into a size-aware component.
 * We only need to translate the icon-style `size` prop into raw SVG
 * `width` / `height`; brand SVGs use `currentColor` so `color` and
 * `className` flow through unchanged. `strokeWidth` is intentionally
 * ignored — brand marks are filled, not stroked, and applying it would
 * be a no-op at best.
 */
function brandIcon(
  Brand: React.FC<React.SVGProps<SVGSVGElement>>,
  displayName: string
): React.ComponentType<Record<string, unknown>> {
  const Wrapped = forwardRef<
    SVGSVGElement,
    React.SVGProps<SVGSVGElement> & { size?: number | string }
  >(({ size = 24, ...rest }, ref) => (
    <Brand width={size} height={size} ref={ref} {...rest} />
  ));
  Wrapped.displayName = displayName;
  // The wrapper spreads arbitrary props onto the SVG at runtime; the cast
  // narrows only the prop bag, never the data-vs-component distinction.
  return Wrapped as unknown as React.ComponentType<Record<string, unknown>>;
}

const canonicalBrandIconCache = new Map<
  IconProvider,
  React.ComponentType<Record<string, unknown>>
>();

function resolveCanonicalBrandIcon(
  iconId: string
): React.ComponentType<Record<string, unknown>> | undefined {
  const iconProvider = isIconProvider(iconId)
    ? iconId
    : getIconProviderFromType(iconId);
  if (iconProvider === "unknown") return undefined;

  const cached = canonicalBrandIconCache.get(iconProvider);
  if (cached) return cached;

  const IconComponent = getIconComponent(iconProvider);
  if (!IconComponent) return undefined;

  const BrandIcon = brandIcon(IconComponent, `${iconProvider}BrandIcon`);
  canonicalBrandIconCache.set(iconProvider, BrandIcon);
  return BrandIcon;
}

const ICON_MAP: Record<string, IconSvgElement> = {
  omega: Omega,
  code: Code,
  monitor: Monitor,
  network: Network,
  brain: Brain,
  "chart-column": ChartColumn,
  "clipboard-list": ClipboardList,
  "drafting-compass": DraftingCompass,
  "flask-conical": FlaskConical,
  users: Users,
  user: User,
  "hand-metal": HandMetal,
  "mouse-pointer-click": MousePointerClick,
  sprout: Sprout,
  terminal: Terminal,
  bot: Bot,
};

const DEFAULT_ICON: IconSvgElement = Bot;

export function resolveAgentIcon(
  iconId: string | undefined | null
): AgentIconSource {
  if (!iconId) return DEFAULT_ICON;

  const canonicalBrandIcon = resolveCanonicalBrandIcon(iconId);
  if (canonicalBrandIcon) return canonicalBrandIcon;

  return ICON_MAP[iconId] ?? DEFAULT_ICON;
}
