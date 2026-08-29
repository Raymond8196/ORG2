/**
 * PersonAvatar
 *
 * The single people-avatar used across ORGII. It wraps `Avatar` with the
 * identity treatment the sidebar account button established: the person's
 * photo when one exists, otherwise their leading initial over a gradient
 * derived from their name, so the same person keeps the same colour on every
 * surface that shows them.
 *
 * Prefer this over a hand-rolled `rounded-full` div with a local colour
 * palette, and over calling `Avatar` directly with hand-derived initials.
 * Those derivations disagreed with each other, which is what made one
 * teammate read as three different people across the app.
 *
 * @example
 * ```tsx
 * <PersonAvatar name="Ada Lovelace" src={avatarUrl} size={28} />
 * <PersonAvatar name="Agent" fallback="✦" size={24} />
 * <PersonAvatar name={person.name} color={person.color} size={18} />
 * ```
 */
import React, { memo, useMemo } from "react";

import Avatar from "@src/components/Avatar";

export interface PersonAvatarProps {
  /** Display name or identity. Seeds both the initial and the gradient. */
  name: string;
  /** Profile image URL; the identity fallback renders when absent. */
  src?: string;
  /** Diameter in pixels. @default 24 */
  size?: number;
  /**
   * Identity colour the domain already assigns this person (Project Manager
   * members carry one, and group headers and status dots render it). When set
   * it replaces the derived gradient, so the avatar agrees with the rest of
   * that surface instead of inventing a second colour for the same person.
   */
  color?: string;
  /** Replaces the derived initial (e.g. a glyph for a non-human author). */
  fallback?: React.ReactNode;
}

/**
 * Leading visible character, upper-cased. Iterates code points rather than
 * UTF-16 units so an emoji or astral-plane name is not sliced into half a
 * surrogate pair.
 */
export function personAvatarInitial(name: string): string {
  const [first] = [...name.trim()];
  return first ? first.toLocaleUpperCase() : "?";
}

const PersonAvatar: React.FC<PersonAvatarProps> = ({
  name,
  src,
  size = 24,
  color,
  fallback,
}) => {
  // `bg-gradient-to-br` paints a background-image, which an inline
  // background-color cannot override — so a domain colour has to suppress the
  // gradient rather than sit behind it.
  const style = useMemo<React.CSSProperties | undefined>(
    () =>
      color
        ? { backgroundColor: color, color: "var(--color-text-white)" }
        : undefined,
    [color]
  );

  return (
    <Avatar
      size={size}
      src={src}
      // An unnamed person has no stable seed; fall back to the neutral fill
      // rather than pinning everyone anonymous to the same gradient.
      gradientSeed={color ? undefined : name.trim() || undefined}
      style={style}
    >
      {fallback ?? personAvatarInitial(name)}
    </Avatar>
  );
};

export default memo(PersonAvatar);
