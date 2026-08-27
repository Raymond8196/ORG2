import X from "@hugeicons/core-free-icons/Cancel01Icon";
import XCircle from "@hugeicons/core-free-icons/CancelCircleIcon";
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import CircleDashed from "@hugeicons/core-free-icons/CircleDashedIcon";
import CircleSlash from "@hugeicons/core-free-icons/CircleSlashIcon";
import Ellipsis from "@hugeicons/core-free-icons/EllipsisIcon";
import LoaderCircle from "@hugeicons/core-free-icons/LoaderCircleIcon";
import Minus from "@hugeicons/core-free-icons/MinusSignIcon";
import Check from "@hugeicons/core-free-icons/Tick01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { PullRequestCiStatus } from "@src/api/tauri/github";

export interface PrCiStatusIndicatorProps {
  appearance?: "circled" | "simple";
  className?: string;
  dataTestId?: string;
  label: string;
  showLabel?: boolean;
  size?: number;
  status: PullRequestCiStatus;
}

const PrCiStatusIndicator: React.FC<PrCiStatusIndicatorProps> = ({
  appearance = "circled",
  className = "",
  dataTestId,
  label,
  showLabel = true,
  size = 14,
  status,
}) => {
  const iconProps = { size, strokeWidth: 1.8 } as const;
  const icon =
    appearance === "simple" ? (
      status === "success" ? (
        <HugeiconsIcon icon={Check} data-icon="check" {...iconProps} />
      ) : status === "failure" ? (
        <HugeiconsIcon icon={X} data-icon="x" {...iconProps} />
      ) : status === "pending" ? (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning-6" />
      ) : status === "none" ? (
        <HugeiconsIcon icon={Minus} data-icon="minus" {...iconProps} />
      ) : (
        <HugeiconsIcon icon={Ellipsis} data-icon="ellipsis" {...iconProps} />
      )
    ) : status === "success" ? (
      <HugeiconsIcon
        icon={CheckCircle2}
        data-icon="check-circle-2"
        {...iconProps}
      />
    ) : status === "failure" ? (
      <HugeiconsIcon icon={XCircle} data-icon="xcircle" {...iconProps} />
    ) : status === "pending" ? (
      <HugeiconsIcon
        icon={LoaderCircle}
        data-icon="loader-circle"
        {...iconProps}
        className="animate-spin"
      />
    ) : status === "none" ? (
      <HugeiconsIcon
        icon={CircleSlash}
        data-icon="circle-slash"
        {...iconProps}
      />
    ) : (
      <HugeiconsIcon
        icon={CircleDashed}
        data-icon="circle-dashed"
        {...iconProps}
      />
    );
  const colorClass =
    status === "success"
      ? "text-success-6"
      : status === "failure"
        ? "text-danger-6"
        : status === "pending"
          ? "text-warning-6"
          : "text-text-3";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${colorClass} ${className}`}
      title={label}
      aria-label={label}
      data-testid={dataTestId}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </span>
  );
};

export default PrCiStatusIndicator;
