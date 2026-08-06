import React from "react";

import { IssueDetailPanel } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import GitHubDetailSkeleton from "@src/modules/shared/components/GitHubDetailSkeleton";
import { useGitHubIssueDetailState } from "@src/modules/shared/hooks/useGitHubIssueDetailState";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { GitHubIssueDetailTabData } from "@src/types/githubDetail";

export function GitHubIssuePanelView({
  detail,
}: {
  detail: GitHubIssueDetailTabData;
}): React.ReactNode {
  const { selectedState, interaction } = useGitHubIssueDetailState(detail);

  if (!selectedState.issue) {
    if (!selectedState.error && (selectedState.loading || detail.remoteUrl)) {
      return <GitHubDetailSkeleton kind="issue" showHeader />;
    }
    return (
      <Placeholder
        variant={selectedState.error ? "error" : "empty"}
        placement="detail-panel"
        subtitle={selectedState.error ?? undefined}
        fillParentHeight
      />
    );
  }

  return (
    <IssueDetailPanel
      issue={selectedState.issue}
      timeline={selectedState.timeline}
      timelineLoading={selectedState.timelineLoading}
      interaction={interaction}
    />
  );
}
