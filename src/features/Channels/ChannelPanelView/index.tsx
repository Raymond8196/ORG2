/**
 * ChannelPanelView — the chat-pane surface behind a `"channel"` tab.
 *
 * One surface, two scopes:
 *
 *  - **local** channels have a WORKING message plane. Posts land in
 *    `localChannelMessagesAtom` (this machine, single user) and survive a
 *    restart; edit and tombstone-delete are available on every row.
 *
 *  - **cloud** channels render the identical header + transcript, but the
 *    composer is replaced by an honest disabled notice. `0014_org_channels.sql`
 *    ships the CONTROL plane only — there are no message RPCs to call, so the
 *    surface says so inline rather than pretending to send (and rather than
 *    firing a toast on every click).
 *
 * The transcript itself is `ChannelMessageList` (virtualized above a
 * threshold, `HumanSessionView`'s construction); the composer follows the
 * `CommentComposer` shape painted with `inputAreaTokens`. Settings reuses the
 * existing per-scope dialog — this view mounts it, never reimplements it.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { MessagesSquare } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import LocalChannelSettingsDialog from "@src/features/LocalChannels/components/LocalChannelSettingsDialog";
import ChannelSettingsDialog from "@src/features/Org2Cloud/channels/components/ChannelSettingsDialog";
import { useOrgChannels } from "@src/features/Org2Cloud/channels/useOrgChannels";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { ChatPanelSelectedChannel } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  type LocalChannelMessageErrorCode,
  deleteLocalChannelMessageAtom,
  editLocalChannelMessageAtom,
  localChannelMessagesForChannelAtomFamily,
  postLocalChannelMessageAtom,
} from "@src/store/ui/localChannelMessagesAtom";
import { localChannelsAtom } from "@src/store/ui/localChannelsAtom";

import ChannelComposer from "./ChannelComposer";
import ChannelMessageList from "./ChannelMessageList";
import ChannelPanelHeader from "./ChannelPanelHeader";

const POST_ERROR_KEYS: Record<LocalChannelMessageErrorCode, string> = {
  empty: "cloud.channels.feed.errorEmpty",
  tooLong: "cloud.channels.feed.errorTooLong",
  quota: "cloud.channels.feed.errorQuota",
  invalid: "cloud.channels.feed.errorGeneric",
};

export interface ChannelPanelViewProps {
  channel: ChatPanelSelectedChannel;
}

// ---------------------------------------------------------------------------
// Local scope — the working message plane
// ---------------------------------------------------------------------------

interface LocalChannelPanelProps {
  channelId: string;
  fallbackName: string;
}

const LocalChannelPanel: React.FC<LocalChannelPanelProps> = ({
  channelId,
  fallbackName,
}) => {
  const { t } = useTranslation("navigation");
  const channels = useAtomValue(localChannelsAtom);
  const messages = useAtomValue(
    localChannelMessagesForChannelAtomFamily(channelId)
  );
  const postMessage = useSetAtom(postLocalChannelMessageAtom);
  const editMessage = useSetAtom(editLocalChannelMessageAtom);
  const deleteMessage = useSetAtom(deleteLocalChannelMessageAtom);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Read the live row so a rename made in the settings dialog shows up here
  // without re-opening the tab; the tab payload is only the fallback.
  const channel = useMemo(
    () => channels.find((candidate) => candidate.id === channelId) ?? null,
    [channelId, channels]
  );

  const handleSubmit = useCallback(
    (body: string): boolean => {
      const result = postMessage({ channelId, body });
      if (result.ok) {
        setComposerError(null);
        return true;
      }
      setComposerError(t(POST_ERROR_KEYS[result.error]));
      return false;
    },
    [channelId, postMessage, t]
  );

  const handleEdit = useCallback(
    (messageId: string, body: string): boolean =>
      editMessage({ id: messageId, body }).ok,
    [editMessage]
  );

  const handleDelete = useCallback(
    (messageId: string) => {
      deleteMessage(messageId);
    },
    [deleteMessage]
  );

  // A channel deleted while its tab is open leaves the pill pointing at
  // nothing; say so instead of rendering an empty transcript.
  if (!channel) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Placeholder
          variant="empty"
          placement="detail-panel"
          fillParentHeight
          icon={<MessagesSquare size={32} strokeWidth={1.5} />}
          title={t("cloud.channels.feed.missingTitle")}
          subtitle={t("cloud.channels.feed.missingSubtitle")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="channel-panel">
      <ChannelPanelHeader
        name={channel.name || fallbackName}
        topic={channel.topic}
        isPrivate={false}
        memberCount={undefined}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Placeholder
            variant="empty"
            placement="detail-panel"
            icon={<MessagesSquare size={32} strokeWidth={1.5} />}
            title={t("cloud.channels.feed.emptyTitle", {
              name: channel.name || fallbackName,
            })}
            subtitle={t("cloud.channels.feed.emptySubtitle")}
          />
        </div>
      ) : (
        <ChannelMessageList
          messages={messages}
          authorLabel={t("cloud.channels.feed.you")}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}
      <ChannelComposer
        channelName={channel.name || fallbackName}
        onSubmit={handleSubmit}
        error={composerError}
      />
      <LocalChannelSettingsDialog
        key={settingsOpen ? `settings-open-${channel.id}` : "settings"}
        open={settingsOpen}
        channel={settingsOpen ? channel : null}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Cloud scope — same surface, composer gated on the backend upgrade
// ---------------------------------------------------------------------------

interface CloudChannelPanelProps {
  orgId: string;
  channelId: string;
  fallbackName: string;
  fallbackIsPrivate: boolean;
}

const CloudChannelPanel: React.FC<CloudChannelPanelProps> = ({
  orgId,
  channelId,
  fallbackName,
  fallbackIsPrivate,
}) => {
  const { t } = useTranslation("navigation");
  const { channels } = useOrgChannels(orgId);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const channel = useMemo(
    () => channels.find((candidate) => candidate.id === channelId) ?? null,
    [channelId, channels]
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="channel-panel">
      <ChannelPanelHeader
        name={channel?.name ?? fallbackName}
        topic={channel?.topic}
        isPrivate={
          channel ? channel.visibility === "private" : fallbackIsPrivate
        }
        memberCount={channel?.memberCount}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Placeholder
          variant="empty"
          placement="detail-panel"
          icon={<MessagesSquare size={32} strokeWidth={1.5} />}
          title={t("cloud.channels.feed.cloudPendingTitle")}
          subtitle={t("cloud.channels.feed.cloudPendingSubtitle")}
        />
      </div>
      {/* Honest disabled state: the cloud message RPCs do not exist yet, so
          the composer explains itself in place instead of accepting text it
          could never send. */}
      <div
        className="shrink-0 px-2 pb-2 pt-1"
        data-testid="channel-composer-disabled"
      >
        <div className="rounded-[12px] border border-dashed border-border-2 bg-fill-1 px-3 py-2.5 text-[12px] text-text-3">
          {t("cloud.channels.feed.cloudComposerDisabled")}
        </div>
      </div>
      <ChannelSettingsDialog
        key={settingsOpen ? `settings-open-${channelId}` : "settings"}
        open={settingsOpen && channel !== null}
        orgId={orgId}
        channel={settingsOpen ? channel : null}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
};

const ChannelPanelView: React.FC<ChannelPanelViewProps> = ({ channel }) =>
  channel.scope === "local" ? (
    <LocalChannelPanel
      channelId={channel.channelId}
      fallbackName={channel.name}
    />
  ) : (
    <CloudChannelPanel
      orgId={channel.orgId}
      channelId={channel.channelId}
      fallbackName={channel.name}
      fallbackIsPrivate={channel.visibility === "private"}
    />
  );

export default ChannelPanelView;
