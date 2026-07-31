/**
 * DiscussionChannelPanelView — the chat-pane surface behind a `"channel"` tab.
 *
 * One surface, two scopes:
 *
 *  - **local** channels have a WORKING message plane. Posts land in
 *    `localChannelMessagesAtom` (this machine, single user) and survive a
 *    restart; edit and tombstone-delete are available on every row.
 *
 *  - **cloud** channels render the identical header + transcript + composer,
 *    but the composer is disabled and says why. `0014_org_channels.sql` ships
 *    the CONTROL plane only — there are no message RPCs to call, so the
 *    surface is honest inline rather than pretending to send (and rather than
 *    firing a toast on every click).
 *
 * Both scopes are built from session parts, not look-alikes: the transcript is
 * `ChannelMessageList` on `DETAIL_PANEL_TOKENS.contentMaxWidth`, and the
 * composer is the real `InputArea` in the absolutely positioned footer
 * `HumanSessionView` uses. Settings reuses the existing per-scope dialog —
 * this view mounts it, never reimplements it.
 *
 * A local channel is also a session DROP target (`useChannelSessionDrop`):
 * dragging a session row or tab anywhere over the panel attaches it to the
 * draft as a reference pill. Cloud channels mount no drop target at all.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { MessagesSquare } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { INPUT_AREA } from "@src/config/inputAreaTokens";
import LocalChannelSettingsDialog from "@src/features/LocalChannels/components/LocalChannelSettingsDialog";
import ChannelSettingsDialog from "@src/features/Org2Cloud/channels/components/ChannelSettingsDialog";
import { useOrgChannels } from "@src/features/Org2Cloud/channels/useOrgChannels";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { SESSION_TAB_DROP_TARGET_HIGHLIGHT_CLASS } from "@src/shared/dnd/sessionTabDrag";
import type { ChatPanelSelectedChannel } from "@src/store/chatPanel/chatPanelTabsAtom";
import {
  deleteLocalChannelMessageAtom,
  editLocalChannelMessageAtom,
  localChannelMessagesForChannelAtomFamily,
  postLocalChannelMessageAtom,
} from "@src/store/ui/localChannelMessagesAtom";
import { localChannelsAtom } from "@src/store/ui/localChannelsAtom";

import ChannelComposer from "./ChannelComposer";
import ChannelMessageList from "./ChannelMessageList";
import ChannelPanelHeader from "./ChannelPanelHeader";
import { createChannelPostHandler } from "./channelPostHandler";
import { useChannelSessionDrop } from "./useChannelSessionDrop";

/**
 * Bottom inset on the empty-state column so the placeholder clears the
 * absolutely positioned composer footer (matches the transcript's `pb-36`).
 */
const EMPTY_STATE_COLUMN_CLASSES =
  "flex min-h-0 flex-1 items-center justify-center pb-36";

const COMPOSER_NOTICE_CLASSES = `border border-dashed border-border-2 bg-fill-1 px-3 py-2.5 text-[12px] text-text-3 ${INPUT_AREA.borderRadiusClass}`;

export interface DiscussionChannelPanelViewProps {
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
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const composerFooterRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<ComposerInputRef | null>(null);

  // Read the live row so a rename made in the settings dialog shows up here
  // without re-opening the tab; the tab payload is only the fallback.
  const channel = useMemo(
    () => channels.find((candidate) => candidate.id === channelId) ?? null,
    [channelId, channels]
  );
  // Archived = read-only (Slack/cloud expectation): a post the store accepts
  // but the cloud plane would refuse on promotion is a semantic cliff.
  const archived = channel !== null && channel.archivedAt !== null;

  // Transcript + composer are ONE drop target: a session dragged from the
  // sidebar or a tab strip anywhere over this panel becomes a pill in the
  // draft, the same reference an `@` mention would produce.
  const sessionDrop = useChannelSessionDrop({
    surfaceRef,
    composerFooterRef,
    composerInputRef,
    disabled: archived,
  });

  // `InputArea` reads its submit handler through `onSubmitOverride`; the
  // refusal path throws so the composer restores the draft (see
  // `channelPostHandler.ts`).
  const handlePost = useMemo(
    () =>
      createChannelPostHandler({
        post: (body) => postMessage({ channelId, body }),
        translate: (key) => t(key),
        onError: setComposerError,
      }),
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

  const displayName = channel.name || fallbackName;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="channel-panel">
      <ChannelPanelHeader
        name={displayName}
        topic={channel.topic}
        isPrivate={false}
        memberCount={undefined}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        ref={surfaceRef}
        data-testid="channel-session-drop-surface"
      >
        {sessionDrop.active ? (
          <div
            className={`${SESSION_TAB_DROP_TARGET_HIGHLIGHT_CLASS} inset-2 flex items-end justify-center pb-40`}
            data-testid="channel-session-drop-zone"
            data-drop-over={String(sessionDrop.over)}
            role="status"
            aria-live="polite"
          >
            <span className="rounded-md border border-border-2 bg-bg-2 px-3 py-1.5 text-xs font-medium text-text-1 shadow-sm">
              {t("cloud.channels.feed.dropSessionHint")}
            </span>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className={EMPTY_STATE_COLUMN_CLASSES}>
            <Placeholder
              variant="empty"
              placement="detail-panel"
              icon={<MessagesSquare size={32} strokeWidth={1.5} />}
              title={t("cloud.channels.feed.emptyTitle", {
                name: displayName,
              })}
              subtitle={t("cloud.channels.feed.emptySubtitle")}
            />
          </div>
        ) : (
          <ChannelMessageList
            messages={messages}
            authorLabel={t("cloud.channels.feed.you")}
            onEdit={archived ? null : handleEdit}
            onDelete={archived ? null : handleDelete}
          />
        )}
        <ChannelComposer
          composerId={`channel-local-${channelId}`}
          placeholder={t("cloud.channels.feed.composerPlaceholder", {
            name: displayName,
          })}
          onSubmit={archived ? null : handlePost}
          acceptDraggedPills={!archived}
          error={archived ? null : composerError}
          notice={
            archived ? (
              <div
                className={COMPOSER_NOTICE_CLASSES}
                data-testid="channel-composer-archived"
              >
                {t("cloud.channels.feed.archivedComposerDisabled")}
              </div>
            ) : undefined
          }
          footerRef={composerFooterRef}
          composerInputRef={composerInputRef}
        />
      </div>
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
  // Archived channels stay browsable (Slack): without includeArchived an
  // open tab for an archived channel would lose its live row — stale header
  // name and no settings — even though the sidebar lets archived rows open.
  // The hook PARTITIONS archived rows into `archivedChannels`; resolving
  // against the live list alone re-creates exactly that stale-header hole.
  const { channels, archivedChannels } = useOrgChannels(orgId, {
    includeArchived: true,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const channel = useMemo(
    () =>
      channels.find((candidate) => candidate.id === channelId) ??
      archivedChannels.find((candidate) => candidate.id === channelId) ??
      null,
    [archivedChannels, channelId, channels]
  );
  const archived = channel?.archivedAt != null;

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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className={EMPTY_STATE_COLUMN_CLASSES}>
          <Placeholder
            variant="empty"
            placement="detail-panel"
            icon={<MessagesSquare size={32} strokeWidth={1.5} />}
            title={t("cloud.channels.feed.cloudPendingTitle")}
            subtitle={t("cloud.channels.feed.cloudPendingSubtitle")}
          />
        </div>
        {/* Honest disabled state: the cloud message RPCs do not exist yet, so
            the SAME composer the local scope gets renders inert with the
            explanation above it, instead of accepting text it could never
            send. For the same reason no session drop target is mounted here
            and `acceptDraggedPills` is off — a reference dropped on a channel
            that cannot post is a promise the surface can't keep. */}
        <ChannelComposer
          composerId={`channel-cloud-${orgId}-${channelId}`}
          placeholder={t("cloud.channels.feed.composerPlaceholder", {
            name: channel?.name ?? fallbackName,
          })}
          onSubmit={null}
          acceptDraggedPills={false}
          notice={
            archived ? (
              <div
                className={COMPOSER_NOTICE_CLASSES}
                data-testid="channel-composer-archived"
              >
                {t("cloud.channels.feed.archivedComposerDisabled")}
              </div>
            ) : (
              <div
                className={COMPOSER_NOTICE_CLASSES}
                data-testid="channel-composer-disabled"
              >
                {t("cloud.channels.feed.cloudComposerDisabled")}
              </div>
            )
          }
        />
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

const DiscussionChannelPanelView: React.FC<DiscussionChannelPanelViewProps> = ({
  channel,
}) =>
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

export default DiscussionChannelPanelView;
