import type React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  ArrowExpand01Icon,
  ArrowShrink01Icon,
  HugeiconsIcon,
} from "@src/icons";

interface SplitListFullscreenButtonProps {
  isFullscreen: boolean;
  onToggle: () => void;
}

/**
 * Header action for switching a split surface back to its established full
 * presentation. Callers own this UI state so the action remains in their
 * existing header rather than creating list chrome.
 */
const SplitListFullscreenButton: React.FC<SplitListFullscreenButtonProps> = ({
  isFullscreen,
  onToggle,
}) => {
  const { t } = useTranslation("common");
  const label = t("actions.maximizeRestore");

  return (
    <Button
      htmlType="button"
      variant="tertiary"
      size="small"
      iconOnly
      title={label}
      aria-label={label}
      aria-pressed={isFullscreen}
      data-testid="split-list-fullscreen-toggle"
      icon={
        <HugeiconsIcon
          icon={isFullscreen ? ArrowShrink01Icon : ArrowExpand01Icon}
          data-icon={isFullscreen ? "minimize-2" : "maximize-2"}
          size={14}
          strokeWidth={1.8}
        />
      }
      onClick={onToggle}
    />
  );
};

export default SplitListFullscreenButton;
