/**
 * Shared renderIcon utility
 *
 * Renders a SidebarIcon (hugeicons glyph data or string icon name)
 * with optional favicon and loading spinner support.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { SidebarIcon } from "../types";

interface RenderIconOptions {
  className?: string;
  size?: number;
  /** Favicon URL — renders an <img> instead of an icon */
  faviconUrl?: string;
  /** Show spin animation (for loading states) */
  isLoading?: boolean;
}

/**
 * Render a sidebar icon consistently across all sidebar components.
 *
 * Supports:
 * - Hugeicons glyph data (IconSvgElement)
 * - String icon names (legacy, renders <i> tag)
 * - Favicon URLs (renders <img>)
 * - Loading spinner animation
 */
export function renderSidebarIcon(
  icon: SidebarIcon | undefined,
  options: RenderIconOptions = {}
): React.ReactNode {
  const { className = "", size = 14, faviconUrl, isLoading = false } = options;

  // Favicon image
  if (faviconUrl) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className={`rounded-sm ${className}`}
        style={{ width: size, height: size }}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  if (!icon) return null;

  // Legacy string icon name
  if (typeof icon === "string") {
    return <i className={`${icon} ${className}`} style={{ fontSize: size }} />;
  }

  // Hugeicons glyph data, rendered through the shared wrapper.
  // strokeWidth is pinned to 2 to preserve the weight lucide rendered at;
  // hugeicons path data defaults to 1.5.
  const animationClass = isLoading ? "animate-spin" : "";
  const combinedClassName = `${className} ${animationClass}`.trim();

  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={2}
      className={combinedClassName}
    />
  );
}
