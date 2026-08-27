import AlertTriangle from "@hugeicons/core-free-icons/Alert01Icon";
import Lightbulb from "@hugeicons/core-free-icons/BulbIcon";
import XCircle from "@hugeicons/core-free-icons/CancelCircleIcon";
import ThumbsUp from "@hugeicons/core-free-icons/ThumbsUpIcon";
import type { IconSvgElement } from "@hugeicons/react";
import React from "react";

import type { ReviewCommentSeverity } from "@src/api/http/project";
import AnyIcon from "@src/components/AnyIcon";

const REVIEW_SEVERITY_CONFIG: Record<
  ReviewCommentSeverity,
  { icon: IconSvgElement; name: string; className: string }
> = {
  error: { icon: XCircle, name: "x-circle", className: "text-danger-6" },
  warning: {
    icon: AlertTriangle,
    name: "alert-triangle",
    className: "text-warning-6",
  },
  suggestion: {
    icon: Lightbulb,
    name: "lightbulb",
    className: "text-primary-6",
  },
  praise: { icon: ThumbsUp, name: "thumbs-up", className: "text-success-6" },
};

interface ReviewSeverityIconProps {
  severity: ReviewCommentSeverity;
  size?: number;
  className?: string;
}

const ReviewSeverityIcon: React.FC<ReviewSeverityIconProps> = ({
  severity,
  size = 12,
  className = "",
}) => {
  const config = REVIEW_SEVERITY_CONFIG[severity];
  return (
    <AnyIcon
      icon={config.icon}
      data-icon={config.name}
      size={size}
      className={`shrink-0 ${config.className} ${className}`}
    />
  );
};

export default ReviewSeverityIcon;
