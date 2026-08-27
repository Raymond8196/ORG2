/**
 * Renders an icon that may arrive in any of the three shapes this app carries.
 *
 * Most icons are hugeicons glyph data (`IconSvgElement`) handed to
 * `HugeiconsIcon`. A few are hand-authored React components — brand marks such
 * as the GitHub and MCP logos, which no icon set provides. A few legacy call
 * sites still pass an icon-font class name as a string.
 *
 * This is NOT a general wrapper around every icon in the app: ordinary call
 * sites render `<HugeiconsIcon icon={Foo} />` directly. Use `AnyIcon` only
 * where the icon's shape genuinely is not known at the call site — registries,
 * menu-item models, and the spotlight item model, which accept all three.
 */
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import React, { type ComponentType } from "react";

export type AnyIconSource =
  | string
  | IconSvgElement
  | ComponentType<Record<string, unknown>>;

export interface AnyIconProps {
  icon: AnyIconSource | undefined;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const AnyIcon: React.FC<AnyIconProps> = ({
  icon,
  size,
  strokeWidth,
  className,
}) => {
  if (!icon) return null;

  // Legacy icon-font class name.
  if (typeof icon === "string") {
    return (
      <i
        className={`${icon} ${className ?? ""}`.trim()}
        style={{ fontSize: size }}
      />
    );
  }

  // Hand-authored SVG component. Glyph data is an array, so `typeof` separates
  // the two cleanly and narrows for both branches.
  if (typeof icon === "function") {
    return React.createElement(icon, { size, strokeWidth, className });
  }

  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={className}
    />
  );
};

export default AnyIcon;
