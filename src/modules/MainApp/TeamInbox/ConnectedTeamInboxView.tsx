import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback } from "react";

import type { ManagedPrItem } from "@src/modules/MainApp/WorkManagement/githubManagedItemModel";
import { openGitHubPrInChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsAtom";

import TeamInboxView from "./TeamInboxView";
import { teamInboxItemFocusRequestAtom } from "./store";
import { useTeamInboxDataSource } from "./useTeamInboxDataSource";
import { useTeamInboxNavigation } from "./useTeamInboxNavigation";
import { useTeamInboxPullRequests } from "./useTeamInboxPullRequests";

const ConnectedTeamInboxView: React.FC = () => {
  const { dataSource, viewerMemberIds } = useTeamInboxDataSource();
  const pullRequests = useTeamInboxPullRequests();
  const focusRequest = useAtomValue(teamInboxItemFocusRequestAtom);
  const navigate = useTeamInboxNavigation();
  const openPrInChatPanel = useSetAtom(openGitHubPrInChatPanelTabAtom);
  const openPullRequestTab = useCallback(
    (pullRequest: ManagedPrItem) => {
      openPrInChatPanel({
        prNumber: pullRequest.id,
        prTitle: pullRequest.title,
        prUrl: pullRequest.rawPr.url,
        prStatus: pullRequest.rawPr.draft ? "draft" : pullRequest.state,
        headBranch: pullRequest.sourceBranch,
        baseBranch: pullRequest.targetBranch,
        repoPath: pullRequest.repoPath,
        repoId: pullRequest.repoId,
      });
    },
    [openPrInChatPanel]
  );
  return (
    <TeamInboxView
      dataSource={dataSource}
      focusRequest={focusRequest}
      viewerMemberIds={viewerMemberIds}
      onNavigate={navigate}
      pullRequests={pullRequests.items}
      pullRequestsLoading={pullRequests.loading}
      pullRequestsError={pullRequests.error}
      onRefreshPullRequests={pullRequests.refresh}
      onOpenPullRequestTab={openPullRequestTab}
    />
  );
};

export default ConnectedTeamInboxView;
