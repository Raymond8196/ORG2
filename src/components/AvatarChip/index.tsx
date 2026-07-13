import React, { memo } from "react";

import Avatar from "@src/components/Avatar";

export type AvatarChipVariant = "display" | "selectable";
export type AvatarChipSize = "xs" | "sm";

interface AvatarChipProps {
  avatarSrc?: string;
  avatarSize?: number;
  label: React.ReactNode;
  variant?: AvatarChipVariant;
  size?: AvatarChipSize;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

const SIZE_CLASSES: Record<AvatarChipSize, string> = {
  xs: "px-1.5 py-[2px] text-[11px]",
  sm: "px-1.5 py-0.5 text-[12px]",
};

const AvatarChip: React.FC<AvatarChipProps> = memo(
  ({
    avatarSrc,
    avatarSize = 14,
    label,
    variant = "display",
    size = "sm",
    selected = false,
    disabled = false,
    className = "",
    labelClassName = "",
    onClick,
  }) => {
    const baseClassName = `inline-flex min-w-0 items-center gap-1 ${SIZE_CLASSES[size]} ${className}`;
    const visualClassName =
      variant === "selectable"
        ? selected
          ? "rounded bg-primary-1 text-primary-6"
          : "rounded text-text-2 transition-colors hover:bg-fill-2"
        : "rounded-full bg-fill-2 text-text-2";
    const content = (
      <>
        <Avatar size={avatarSize} src={avatarSrc} />
        <span className={`min-w-0 truncate ${labelClassName}`}>{label}</span>
      </>
    );

    if (onClick) {
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className={`${baseClassName} ${visualClassName}`}
        >
          {content}
        </button>
      );
    }

    return (
      <span className={`${baseClassName} ${visualClassName}`}>{content}</span>
    );
  }
);

AvatarChip.displayName = "AvatarChip";

export default AvatarChip;
