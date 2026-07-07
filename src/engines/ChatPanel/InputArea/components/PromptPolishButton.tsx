import { Loader2, Sparkles } from "lucide-react";
import React, { memo } from "react";

import Tooltip from "@src/components/Tooltip";
import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import type { PromptPolishControl } from "@src/engines/ChatPanel/hooks/useInputArea/types";

interface PromptPolishButtonProps {
  control: PromptPolishControl;
  disabled?: boolean;
}

const PromptPolishButton: React.FC<PromptPolishButtonProps> = memo(
  ({ control, disabled = false }) => {
    if (!control.isAvailable) return null;

    const isDisabled = control.isPolishing || (disabled && !control.isPolished);
    const tooltip = control.isPolished
      ? "恢复润色前内容"
      : control.isPolishing
        ? "正在润色"
        : disabled
          ? "请输入文字后润色"
          : "润色";

    const baseClass = `flex ${INPUT_AREA_BUTTONS.iconButtonSizeClass} shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus:outline-none`;
    const stateClass = isDisabled
      ? "cursor-not-allowed bg-transparent text-text-4 opacity-60"
      : control.isPolished
        ? "cursor-pointer bg-primary-1 text-primary-6 hover:bg-primary-2"
        : "cursor-pointer bg-fill-1 text-text-2 hover:bg-fill-2 hover:text-text-1";

    const button = (
      <button
        type="button"
        aria-label={tooltip}
        aria-pressed={control.isPolished}
        disabled={isDisabled}
        data-testid="prompt-polish-button"
        data-state={control.status}
        className={`${baseClass} ${stateClass} leading-none`}
        style={{ lineHeight: 0 }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          void control.toggle();
        }}
      >
        {control.isPolishing ? (
          <Loader2
            size={INPUT_AREA_BUTTONS.iconSize}
            strokeWidth={2}
            className="block animate-spin"
          />
        ) : (
          <Sparkles
            size={INPUT_AREA_BUTTONS.iconSize}
            strokeWidth={2}
            className="block"
          />
        )}
      </button>
    );

    return (
      <Tooltip content={tooltip} position="top-end" mouseEnterDelay={200}>
        <span className="inline-flex">{button}</span>
      </Tooltip>
    );
  }
);

PromptPolishButton.displayName = "PromptPolishButton";

export default PromptPolishButton;
