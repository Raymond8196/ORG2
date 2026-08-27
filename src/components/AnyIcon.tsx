/**
 * Safe renderer for an icon whose shape is not known at the call site.
 *
 * Most icons in this app are hugeicons glyph data (`IconSvgElement`) rendered
 * directly with `<HugeiconsIcon icon={Search} />`. Those call sites do NOT need
 * this component and should keep using `HugeiconsIcon`.
 *
 * Use `AnyIcon` where the icon arrives dynamically — from a registry lookup, a
 * prop, a ternary, a menu-item model. Three things can show up there:
 *
 *   - hugeicons glyph data            -> rendered via `HugeiconsIcon`
 *   - a hand-authored SVG component   -> brand marks (GitHub, MCP) that no icon
 *                                        set provides
 *   - a legacy icon-font class name   -> a few old call sites still pass one
 *
 * ...and a fourth: nothing at all. `HugeiconsIcon` does `[...icon]` internally,
 * so an `undefined` icon throws
 * "Spread syntax requires ...iterable[Symbol.iterator] to be a function"
 * and takes down the entire render tree — a whole screen lost to one missing
 * icon, with nothing in the message identifying which. `Record` lookups make
 * this easy to hit: `noUncheckedIndexedAccess` is off, so `ICONS[key]` is typed
 * as present while returning `undefined` for any key that is not.
 *
 * This component degrades that to a missing icon: it renders `null`, and in dev
 * it warns once with whatever context the caller supplied via `data-icon`.
 */
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import React, { type ComponentType } from "react";

export type AnyIconSource =
  | string
  | IconSvgElement
  | ComponentType<Record<string, unknown>>;

export interface AnyIconProps {
  icon: AnyIconSource | undefined | null;
  size?: number;
  strokeWidth?: number;
  className?: string;
  [key: string]: unknown;
}

const warned = new Set<string>();

const AnyIcon: React.FC<AnyIconProps> = ({
  icon,
  size,
  strokeWidth,
  className,
  ...rest
}) => {
  if (icon === undefined || icon === null) {
    if (process.env.NODE_ENV !== "production") {
      const key = String(rest["data-icon"] ?? "unknown");
      if (!warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[AnyIcon] no icon resolved (data-icon="${key}"). Rendering nothing ` +
            `instead of throwing. Check the registry or prop feeding this site.`
        );
      }
    }
    return null;
  }

  // Legacy icon-font class name.
  if (typeof icon === "string") {
    return (
      <i
        className={`${icon} ${className ?? ""}`.trim()}
        style={{ fontSize: size }}
        {...rest}
      />
    );
  }

  // Hand-authored SVG component. Glyph data is an array, so `typeof` separates
  // the two cleanly.
  if (typeof icon === "function") {
    return React.createElement(icon, { size, strokeWidth, className, ...rest });
  }

  // Anything else that is not array-like would throw inside HugeiconsIcon.
  if (!Array.isArray(icon)) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[AnyIcon] icon is neither glyph data nor a component",
        icon
      );
    }
    return null;
  }

  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      {...rest}
    />
  );
};

export default AnyIcon;
