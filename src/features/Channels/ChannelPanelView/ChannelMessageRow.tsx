/**
 * One transcript row — either a date divider or a message.
 *
 * Message bodies render through `MarkDown` (the same component the session
 * transcript uses) so a channel post reads like agent/user output. A
 * tombstoned row renders the italic "message deleted" line instead, matching
 * how `CommentThreadList` keeps a deleted comment's slot in the thread.
 *
 * Edit is inline (`Textarea` + Save / Cancel), the shape the comment plane
 * already uses — no dialog, no separate route.
 */
import { Check, Pencil, Trash2, X } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Avatar from "@src/components/Avatar";
import Button from "@src/components/Button";
import MarkDown from "@src/components/MarkDown";
import Textarea from "@src/components/Textarea";
import Tooltip from "@src/components/Tooltip";
import type { LocalChannelMessage } from "@src/store/ui/localChannelMessagesAtom";
import { LOCAL_CHANNEL_MESSAGE_MAX_LENGTH } from "@src/store/ui/localChannelMessagesAtom";
import { formatLocalClock } from "@src/util/data/formatters/date";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import type { ChannelDateDividerLabel } from "./channelFeedRows";

export interface ChannelDateDividerProps {
  label: ChannelDateDividerLabel;
}

export const ChannelDateDivider: React.FC<ChannelDateDividerProps> = ({
  label,
}) => {
  const { t } = useTranslation("navigation");
  const text =
    label.kind === "today"
      ? t("cloud.channels.feed.today")
      : label.kind === "yesterday"
        ? t("cloud.channels.feed.yesterday")
        : label.date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year:
              label.date.getFullYear() === new Date().getFullYear()
                ? undefined
                : "numeric",
          });

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      data-testid="channel-date-divider"
    >
      <div className="h-px flex-1 bg-border-2" />
      <span className="shrink-0 text-[11px] font-medium text-text-3">
        {text}
      </span>
      <div className="h-px flex-1 bg-border-2" />
    </div>
  );
};

export interface ChannelMessageRowProps {
  message: LocalChannelMessage;
  /** Continues the block above: avatar + author line are suppressed. */
  grouped: boolean;
  /** Author label for the single local user (already localized). */
  authorLabel: string;
  /** Null on the cloud variant — its message plane is not writable yet. */
  onEdit: ((messageId: string, body: string) => boolean) | null;
  onDelete: ((messageId: string) => void) | null;
}

const ChannelMessageRow: React.FC<ChannelMessageRowProps> = ({
  message,
  grouped,
  authorLabel,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation("navigation");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const isTombstone = message.deletedAt !== null;
  const canEdit = onEdit !== null && !isTombstone;
  const canDelete = onDelete !== null && !isTombstone;

  const startEditing = useCallback(() => {
    setDraft(message.body);
    setEditing(true);
  }, [message.body]);

  const saveEdit = useCallback(() => {
    if (!onEdit) return;
    // Keep the editor open on refusal so the text is never thrown away.
    if (onEdit(message.id, draft)) setEditing(false);
  }, [draft, message.id, onEdit]);

  return (
    <div
      className={`group/channelmsg flex gap-2 px-4 ${grouped ? "py-0.5" : "pb-1 pt-2"}`}
      data-testid="channel-message"
      data-message-id={message.id}
    >
      <div className="w-7 shrink-0">
        {grouped ? null : (
          <Avatar size={28}>{authorLabel.slice(0, 1).toUpperCase()}</Avatar>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {grouped ? null : (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-semibold text-text-1">
              {authorLabel}
            </span>
            <Tooltip
              content={formatRelativeTime(message.createdAt, "long")}
              framedPanel
            >
              <span className="shrink-0 text-[11px] text-text-3">
                {formatLocalClock(new Date(message.createdAt), undefined)}
              </span>
            </Tooltip>
            {message.editedAt !== null && !isTombstone ? (
              <span
                className="shrink-0 text-[11px] text-text-4"
                data-testid="channel-message-edited"
              >
                {t("cloud.channels.feed.edited")}
              </span>
            ) : null}
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/channelmsg:opacity-100 group-hover/channelmsg:opacity-100">
              {canEdit ? (
                <Tooltip content={t("cloud.channels.feed.edit")} framedPanel>
                  <Button
                    htmlType="button"
                    variant="tertiary"
                    size="mini"
                    iconOnly
                    aria-label={t("cloud.channels.feed.edit")}
                    data-testid="channel-message-edit"
                    icon={<Pencil size={12} strokeWidth={2} />}
                    onClick={startEditing}
                  />
                </Tooltip>
              ) : null}
              {canDelete ? (
                <Tooltip content={t("cloud.channels.feed.delete")} framedPanel>
                  <Button
                    htmlType="button"
                    variant="tertiary"
                    size="mini"
                    iconOnly
                    aria-label={t("cloud.channels.feed.delete")}
                    data-testid="channel-message-delete"
                    icon={<Trash2 size={12} strokeWidth={2} />}
                    onClick={() => onDelete?.(message.id)}
                  />
                </Tooltip>
              ) : null}
            </span>
          </div>
        )}

        {isTombstone ? (
          <div
            className="text-[12px] italic text-text-3"
            data-testid="channel-message-tombstone"
          >
            {t("cloud.channels.feed.deletedMessage")}
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-1.5">
            <Textarea
              value={draft}
              onChange={(value) => setDraft(value)}
              size="small"
              autoSize
              rows={2}
              maxLength={LOCAL_CHANNEL_MESSAGE_MAX_LENGTH}
              autoFocus
              data-testid="channel-message-edit-input"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                htmlType="button"
                variant="tertiary"
                size="mini"
                icon={<X size={12} strokeWidth={2} />}
                data-testid="channel-message-edit-cancel"
                onClick={() => setEditing(false)}
              >
                {t("cloud.channels.cancel")}
              </Button>
              <Button
                htmlType="button"
                variant="primary"
                size="mini"
                disabled={draft.trim().length === 0}
                icon={<Check size={12} strokeWidth={2} />}
                data-testid="channel-message-edit-save"
                onClick={saveEdit}
              >
                {t("cloud.channels.feed.save")}
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="min-w-0 break-words text-[13px] leading-6 text-text-1"
            data-testid="channel-message-body"
          >
            <MarkDown textContent={message.body} skipPreprocess />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelMessageRow;
