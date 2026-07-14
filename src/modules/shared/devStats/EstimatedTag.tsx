/**
 * EstimatedTag — small "ESTIMATED" affordance for cost columns/cards.
 *
 * Token-only usage sources (Cursor, Claude Code, CLI tools) have no metered
 * spend, so their dollar figures are estimated from tokens × list price. This
 * marker communicates that, mirroring the recorded-vs-estimated distinction the
 * Sessions view conveys through cost styling.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import Tag from "@src/components/Tag";
import Tooltip from "@src/components/Tooltip";

const EstimatedTag: React.FC = memo(() => {
  const { t } = useTranslation();
  return (
    <Tooltip content={t("otherUsage.estimatedTooltip")} position="top">
      <span className="inline-flex">
        <Tag color="warning" size="mini">
          {t("otherUsage.estimated")}
        </Tag>
      </span>
    </Tooltip>
  );
});

EstimatedTag.displayName = "EstimatedTag";

/** Column header that pairs a label with the ESTIMATED marker. */
export const EstimatedCostHeader: React.FC<{ label: string }> = memo(
  ({ label }) => (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <EstimatedTag />
    </span>
  )
);

EstimatedCostHeader.displayName = "EstimatedCostHeader";

export default EstimatedTag;
