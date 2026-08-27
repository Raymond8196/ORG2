import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Circle from "@hugeicons/core-free-icons/CircleIcon";
import CircleX from "@hugeicons/core-free-icons/CircleXIcon";
import LoaderCircle from "@hugeicons/core-free-icons/LoaderCircleIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";
import { useTranslation } from "react-i18next";

import { SESSION_UI_TOKENS } from "@src/engines/ChatPanel/blocks/primitives";

import {
  type CanvasRevisionActivityPhase,
  type CanvasRevisionStepState,
  getCanvasRevisionStepStates,
} from "./canvasRevisionActivityState";

interface CanvasRevisionStepsProps {
  phase: CanvasRevisionActivityPhase;
  steps: readonly string[];
  className?: string;
}

const StepIcon: React.FC<{ state: CanvasRevisionStepState }> = ({ state }) => {
  const size = SESSION_UI_TOKENS.ICON.SIZE_XS;
  if (state === "complete") {
    return (
      <HugeiconsIcon
        icon={CheckCircle2}
        data-icon="check-circle-2"
        size={size}
        className="text-success-6"
        aria-hidden
      />
    );
  }
  if (state === "active") {
    return (
      <HugeiconsIcon
        icon={LoaderCircle}
        data-icon="loader-circle"
        size={size}
        className="animate-spin text-primary-6 motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (state === "failed") {
    return (
      <HugeiconsIcon
        icon={CircleX}
        data-icon="circle-x"
        size={size}
        className="text-danger-6"
        aria-hidden
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={Circle}
      data-icon="circle"
      size={size}
      className="text-text-4"
      aria-hidden
    />
  );
};

const CanvasRevisionSteps: React.FC<CanvasRevisionStepsProps> = ({
  phase,
  steps,
  className = "",
}) => {
  const { t } = useTranslation("sessions");
  if (steps.length === 0) return null;
  const states = getCanvasRevisionStepStates(phase, steps.length);

  return (
    <ol
      className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${className}`.trim()}
      aria-label={t("canvasApp.revisionStepsLabel", "Canvas update progress")}
    >
      {steps.map((label, index) => {
        const state = states[index] ?? "pending";
        return (
          <li
            key={`${index}-${label}`}
            className={`chat-block-xs flex min-w-0 max-w-full items-center gap-1 ${
              state === "pending" ? "text-text-4" : "text-text-3"
            }`}
            data-step-state={state}
          >
            <span className="shrink-0">
              <StepIcon state={state} />
            </span>
            <span className="min-w-0 truncate" title={label}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

CanvasRevisionSteps.displayName = "CanvasRevisionSteps";

export default CanvasRevisionSteps;
