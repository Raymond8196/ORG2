import type { TFunction } from "i18next";
import React, { useMemo } from "react";

import { ChatPanelHeaderBreadcrumb } from "@src/engines/ChatPanel/header";
import {
  COLLAB_CONNECTION_STATUS,
  type CollabConnectionStatus,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import type { ChatPanelSelectedCollabOrg } from "@src/store/ui/chatPanelAtom";

const COLLAB_HEADER_STATUS_COLOR: Record<CollabConnectionStatus, string> = {
  [COLLAB_CONNECTION_STATUS.CONNECTED]: "bg-success-6",
  [COLLAB_CONNECTION_STATUS.CONNECTING]: "bg-warning-6",
  [COLLAB_CONNECTION_STATUS.DISCONNECTED]: "bg-fill-4",
  [COLLAB_CONNECTION_STATUS.ERROR]: "bg-danger-6",
};

function CollabHeaderStatusPill({
  label,
  status,
}: {
  label: string;
  status: CollabConnectionStatus;
}): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] font-medium text-text-2">
      <span
        className={`h-1.5 w-1.5 rounded-full ${COLLAB_HEADER_STATUS_COLOR[status]}`}
      />
      {label}
    </span>
  );
}

function isActiveToday(lastActivityAt: string | null | undefined): boolean {
  if (!lastActivityAt) return false;
  const date = new Date(lastActivityAt);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

interface UseCollabOrgHeaderModelOptions {
  collabConnectionStates: CollabOrgConnectionState[];
  collabMembers: CollabMemberRecord[];
  collabOrgs: CollabOrgRecord[];
  remoteTeammateSessions: RemoteTeammateSessionMetadata[];
  selectedCollabOrg: ChatPanelSelectedCollabOrg | null;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

export function useCollabOrgHeaderModel({
  collabConnectionStates,
  collabMembers,
  collabOrgs,
  remoteTeammateSessions,
  selectedCollabOrg,
  t,
}: UseCollabOrgHeaderModelOptions) {
  return useMemo(() => {
    if (!selectedCollabOrg) return null;
    const org = collabOrgs.find(
      (candidate) => candidate.id === selectedCollabOrg.orgId
    );
    const orgMembers = collabMembers.filter(
      (member) => member.orgId === selectedCollabOrg.orgId && !member.removedAt
    );
    const selectedMember = selectedCollabOrg.memberId
      ? orgMembers.find((member) => member.id === selectedCollabOrg.memberId)
      : null;
    const orgSessions = remoteTeammateSessions.filter(
      (session) => session.orgId === selectedCollabOrg.orgId
    );
    const connectionState = collabConnectionStates.find(
      (state) => state.orgId === selectedCollabOrg.orgId
    );
    const activeMemberIds = new Set(
      orgSessions
        .filter((session) => isActiveToday(session.lastActivityAt))
        .map((session) => session.ownerMemberId)
    );
    const connected =
      connectionState?.status === COLLAB_CONNECTION_STATUS.CONNECTED;
    const status: CollabConnectionStatus = selectedMember
      ? activeMemberIds.has(selectedMember.id)
        ? COLLAB_CONNECTION_STATUS.CONNECTED
        : COLLAB_CONNECTION_STATUS.DISCONNECTED
      : (connectionState?.status ?? COLLAB_CONNECTION_STATUS.DISCONNECTED);
    const statusLabel = selectedMember
      ? activeMemberIds.has(selectedMember.id)
        ? t("navigation:collaboration.status.activeToday")
        : t("navigation:collaboration.status.idle")
      : connected
        ? t("navigation:collaboration.status.connected")
        : t("navigation:collaboration.status.offline");
    const orgTitle = org?.name ?? t("navigation:collaboration.orgDemoTitle");
    const title = selectedMember?.displayName ?? orgTitle;
    const breadcrumbItems = selectedMember
      ? [
          { key: "org", label: orgTitle },
          { key: "member", label: selectedMember.displayName },
        ]
      : [{ key: "org", label: orgTitle }];
    const titleContent = (
      <ChatPanelHeaderBreadcrumb
        items={breadcrumbItems}
        trailing={
          <CollabHeaderStatusPill label={statusLabel} status={status} />
        }
      />
    );
    return { title, titleContent };
  }, [
    collabConnectionStates,
    collabMembers,
    collabOrgs,
    remoteTeammateSessions,
    selectedCollabOrg,
    t,
  ]);
}
