import GitMerge from "@hugeicons/core-free-icons/GitMergeIcon";
import GitPullRequestClosed from "@hugeicons/core-free-icons/GitPullRequestClosedIcon";
import GitPullRequestDraft from "@hugeicons/core-free-icons/GitPullRequestDraftIcon";
import GitPullRequest from "@hugeicons/core-free-icons/GitPullRequestIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import GitHubDetailHeaderContent from "@src/modules/shared/components/GitHubDetailHeaderContent";
import {
  getPrStatusIconName,
  getPrStatusVariant,
} from "@src/shared/pr/prStatus";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";

/** Semantic pull-request icon shared by compact and expanded status surfaces. */
export function PrStatusIcon({ status }: { status: string }): React.ReactNode {
  const iconName = getPrStatusIconName(status);
  const StatusIcon =
    iconName === "draft"
      ? GitPullRequestDraft
      : iconName === "merge"
        ? GitMerge
        : iconName === "closed"
          ? GitPullRequestClosed
          : GitPullRequest;

  return (
    <HugeiconsIcon icon={StatusIcon} size={14} strokeWidth={1.75} aria-hidden />
  );
}

/** Shared status, number, and title content for every PR detail host header. */
export function PrDetailHeaderContent({
  identity,
}: {
  identity: PrIdentity;
}): React.ReactNode {
  const statusVariant = getPrStatusVariant(identity.status);

  return (
    <GitHubDetailHeaderContent
      number={identity.number}
      title={identity.title}
      status={
        <span
          className={`inline-flex h-5 shrink-0 items-center ${statusVariant.textClass}`}
          data-testid="pr-detail-status"
          aria-label={identity.status}
          title={identity.status}
        >
          <PrStatusIcon status={identity.status} />
        </span>
      }
    />
  );
}
