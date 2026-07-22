import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import {
  COLLAB_SESSION_ACCESS_MODE,
  type RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import {
  type FormatSmartDateTimeOptions,
  formatSmartDateTime,
} from "@src/util/data/formatters/date";
import { formatModelNameFull } from "@src/util/formatModelName";

export interface CloudSessionTableLabels {
  fullReplay: string;
  metadataOnly: string;
  notPublished: string;
}

export function toCloudSessionTableItem(
  session: RemoteTeammateSessionMetadata,
  labels: CloudSessionTableLabels,
  dateTimeOptions?: FormatSmartDateTimeOptions
): SessionTableItem {
  const replayable = session.eventsEpoch !== undefined;
  const metadataOnly =
    session.accessMode === COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY;
  const statusLabel = metadataOnly
    ? labels.metadataOnly
    : replayable
      ? labels.fullReplay
      : labels.notPublished;
  const statusColor = metadataOnly
    ? "var(--color-text-4)"
    : replayable
      ? "var(--color-success-6)"
      : "var(--color-warning-6)";
  const workspace = session.repoScopeKey ?? session.repoPath;

  return {
    id: session.id,
    title: session.title,
    description: session.ownerDisplayName,
    statusLabel,
    statusColor,
    ownerLabel: session.ownerDisplayName,
    agentLabel: session.agentDisplayName ?? session.cliAgentType,
    modelLabel: session.model ? formatModelNameFull(session.model) : undefined,
    workspaceLabel: workspace,
    workspaceTitle: workspace,
    lastUpdatedLabel: formatSmartDateTime(
      session.lastActivityAt,
      dateTimeOptions
    ),
    disabled: !replayable,
    testId: "cloud-org-session-row",
    dataAttributes: {
      "data-cloud-session-id": session.sourceSessionId,
      "data-cloud-session-owner-id": session.ownerUserId,
      "data-cloud-session-access-mode": session.accessMode,
    },
  };
}
