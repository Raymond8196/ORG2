import React from "react";

import { IssueDetailPanel } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueDetailPanel";
import { useGitHubIssueDetailState } from "@src/modules/shared/hooks/useGitHubIssueDetailState";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { GitHubIssueDetailTabData } from "@src/types/githubDetail";

export function GitHubIssuePanelView({
  detail,
}: {
  detail: GitHubIssueDetailTabData;
}): React.ReactNode {
  const { selectedState, interaction, assigneeConfig } =
    useGitHubIssueDetailState(detail);

  if (!selectedState.issue) {
    return (
      <Placeholder
        variant={
          selectedState.loading
            ? "loading"
            : selectedState.error
              ? "error"
              : "empty"
        }
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
      assigneeConfig={assigneeConfig}
    />
  );
}
