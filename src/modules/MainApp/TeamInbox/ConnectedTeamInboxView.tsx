import React from "react";

import TeamInboxView from "./TeamInboxView";
import { useTeamInboxDataSource } from "./useTeamInboxDataSource";
import { useTeamInboxNavigation } from "./useTeamInboxNavigation";
import { useTeamInboxPullRequests } from "./useTeamInboxPullRequests";

const ConnectedTeamInboxView: React.FC = () => {
  const { dataSource, viewerMemberIds } = useTeamInboxDataSource();
  const pullRequests = useTeamInboxPullRequests();
  const navigate = useTeamInboxNavigation();
  return (
    <TeamInboxView
      dataSource={dataSource}
      viewerMemberIds={viewerMemberIds}
      onNavigate={navigate}
      pullRequests={pullRequests.items}
      pullRequestsLoading={pullRequests.loading}
      pullRequestsError={pullRequests.error}
      onRefreshPullRequests={pullRequests.refresh}
    />
  );
};

export default ConnectedTeamInboxView;
