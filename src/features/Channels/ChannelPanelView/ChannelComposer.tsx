/**
 * Bottom-anchored channel composer.
 *
 * Shape borrowed from `CommentThreadList`'s `CommentComposer` (autoSize
 * `Textarea`, `maxLength`, Cmd/Ctrl+Enter submit, draft preserved when the
 * submit fails) rather than from the chat `InputArea`: that component is
 * bound to a live session (`useSessionId` / `useSessionDiscovery` / agent
 * model + mode pills), and a channel has no session to drive it with.
 *
 * The session LOOK comes from `inputAreaTokens` instead — the same shell
 * radius, background, and focus ring the chat composer paints — so the
 * surface still reads as a transcript input.
 */
import { SendHorizontal } from "lucide-react";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Textarea from "@src/components/Textarea";
import {
  CHAT_INPUT_CONTAINER_STYLE,
  INPUT_AREA,
  INPUT_AREA_CLASSES,
} from "@src/config/inputAreaTokens";
import { LOCAL_CHANNEL_MESSAGE_MAX_LENGTH } from "@src/store/ui/localChannelMessagesAtom";

export interface ChannelComposerProps {
  channelName: string;
  /** Resolves false when the post was refused — the draft is then kept. */
  onSubmit: (body: string) => boolean;
  /** Inline error from the last refused submit (already localized). */
  error: string | null;
}

const ChannelComposer: React.FC<ChannelComposerProps> = ({
  channelName,
  onSubmit,
  error,
}) => {
  const { t } = useTranslation("navigation");
  const [body, setBody] = useState("");
  const trimmed = body.trim();

  const submit = useCallback(() => {
    if (trimmed.length === 0) return;
    // Draft restore: clear only when the post actually landed.
    if (onSubmit(trimmed)) setBody("");
  }, [onSubmit, trimmed]);

  return (
    <div
      className="flex w-full shrink-0 flex-col gap-1 px-2 pb-2 pt-1"
      data-testid="channel-composer"
    >
      {error ? (
        <div
          role="alert"
          className="px-1 text-[11px] text-danger-6"
          data-testid="channel-composer-error"
        >
          {error}
        </div>
      ) : null}
      <div
        className={`flex w-full flex-col gap-1 px-2 ${INPUT_AREA_CLASSES.containerChatPanel} ${INPUT_AREA.shellInteractionClasses}`}
        style={CHAT_INPUT_CONTAINER_STYLE}
      >
        <Textarea
          value={body}
          onChange={(value) => setBody(value)}
          placeholder={t("cloud.channels.feed.composerPlaceholder", {
            name: channelName,
          })}
          aria-label={t("cloud.channels.feed.composerPlaceholder", {
            name: channelName,
          })}
          size="small"
          autoSize
          rows={2}
          maxLength={LOCAL_CHANNEL_MESSAGE_MAX_LENGTH}
          data-testid="channel-composer-input"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-4">
            {t("cloud.channels.feed.composerHint")}
          </span>
          <Button
            htmlType="button"
            variant="primary"
            size="mini"
            disabled={trimmed.length === 0}
            icon={<SendHorizontal size={12} strokeWidth={2} />}
            data-testid="channel-composer-send"
            onClick={submit}
          >
            {t("cloud.channels.feed.send")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ChannelComposer;
