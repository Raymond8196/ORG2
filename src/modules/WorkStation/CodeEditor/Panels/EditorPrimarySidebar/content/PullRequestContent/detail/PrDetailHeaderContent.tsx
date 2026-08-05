import { GitPullRequest } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import IntegrationIcon from "@src/components/IntegrationIcon";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { getPrStatusVariant } from "@src/shared/pr/prStatus";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

/** Shared status, number, and title content for every PR detail host header. */
export function PrDetailHeaderContent({
  identity,
}: {
  identity: PrIdentity;
}): React.ReactNode {
  const { t } = useTranslation("common");
  const statusVariant = getPrStatusVariant(identity.status);

  return (
    <>
      <IntegrationIcon
        type="github"
        size={HEADER_ICON_SIZE.sm}
        className="shrink-0"
      />
      <span
        className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${statusVariant.badgeClass}`}
      >
        <GitPullRequest size={12} strokeWidth={2} />
        {t(`git.pr.status.${identity.status}`, identity.status)}
      </span>
      <span className="shrink-0 select-text text-[11px] text-text-3">
        #{identity.number}
      </span>
      <span
        className="min-w-0 flex-1 select-text truncate text-[13px] font-medium text-text-1"
        title={identity.title}
      >
        {identity.title}
      </span>
    </>
  );
}
