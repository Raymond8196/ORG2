import { CheckCircle2, Circle, CircleX, LoaderCircle } from "lucide-react";
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
  className?: string;
}

const StepIcon: React.FC<{ state: CanvasRevisionStepState }> = ({ state }) => {
  const size = SESSION_UI_TOKENS.ICON.SIZE_XS;
  if (state === "complete") {
    return <CheckCircle2 size={size} className="text-success-6" aria-hidden />;
  }
  if (state === "active") {
    return (
      <LoaderCircle
        size={size}
        className="animate-spin text-primary-6 motion-reduce:animate-none"
        aria-hidden
      />
    );
  }
  if (state === "failed") {
    return <CircleX size={size} className="text-danger-6" aria-hidden />;
  }
  return <Circle size={size} className="text-text-4" aria-hidden />;
};

const CanvasRevisionSteps: React.FC<CanvasRevisionStepsProps> = ({
  phase,
  className = "",
}) => {
  const { t } = useTranslation("sessions");
  const states = getCanvasRevisionStepStates(phase);
  const steps = [
    {
      key: "target",
      label: t("canvasApp.revisionStepTarget", "Locate existing Canvas"),
      state: states.target,
    },
    {
      key: "generate",
      label: t("canvasApp.revisionStepGenerate", "Generate change"),
      state: states.generate,
    },
    {
      key: "apply",
      label: t("canvasApp.revisionStepApply", "Apply and validate"),
      state: states.apply,
    },
  ] as const;

  return (
    <ol
      className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${className}`.trim()}
      aria-label={t("canvasApp.revisionStepsLabel", "Canvas update progress")}
    >
      {steps.map((step) => (
        <li
          key={step.key}
          className={`chat-block-xs flex min-w-0 items-center gap-1 ${
            step.state === "pending" ? "text-text-4" : "text-text-3"
          }`}
          data-step-state={step.state}
        >
          <StepIcon state={step.state} />
          <span className="whitespace-nowrap">{step.label}</span>
        </li>
      ))}
    </ol>
  );
};

CanvasRevisionSteps.displayName = "CanvasRevisionSteps";

export default CanvasRevisionSteps;
