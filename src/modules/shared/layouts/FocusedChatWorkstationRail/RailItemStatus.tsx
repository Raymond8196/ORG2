/**
 * RailItemStatus — CI badge shown at the end of a rail row (e.g. the PR row).
 */
import XCircle from "@hugeicons/core-free-icons/CancelCircleIcon";
import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import CircleSlash from "@hugeicons/core-free-icons/CircleSlashIcon";
import LoaderCircle from "@hugeicons/core-free-icons/Loading03Icon";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FocusedChatRailItem } from "./types";

export function RailItemStatus({
  status,
}: {
  status: NonNullable<FocusedChatRailItem["status"]>;
}) {
  const commonProps = {
    "aria-hidden": true,
    className: "shrink-0",
    size: 12,
    strokeWidth: 2,
  } as const;
  const icon =
    status.state === "success" ? (
      <HugeiconsIcon
        icon={CheckCircle2}
        data-icon="check-circle-2"
        {...commonProps}
      />
    ) : status.state === "failure" ? (
      <HugeiconsIcon icon={XCircle} data-icon="xcircle" {...commonProps} />
    ) : status.state === "checking" || status.state === "pending" ? (
      <HugeiconsIcon
        icon={LoaderCircle}
        data-icon="loader-circle"
        {...commonProps}
        className="shrink-0 animate-spin"
      />
    ) : (
      <HugeiconsIcon
        icon={CircleSlash}
        data-icon="circle-slash"
        {...commonProps}
      />
    );
  const colorClass =
    status.state === "success"
      ? "text-success-6"
      : status.state === "failure"
        ? "text-danger-6"
        : status.state === "checking" || status.state === "pending"
          ? "text-warning-6"
          : "text-text-3";

  return (
    <span
      className={`flex shrink-0 items-center gap-1 text-[11px] ${colorClass}`}
      title={status.title}
      aria-label={status.title}
    >
      {icon}
      <span>{status.label}</span>
    </span>
  );
}
