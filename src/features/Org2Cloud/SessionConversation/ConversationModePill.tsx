import Bot from "@hugeicons/core-free-icons/BotIcon";
import MessagesSquare from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";
import { useTranslation } from "react-i18next";

import SelectorPill from "@src/components/SelectorPill";

import {
  useConversationComposerMode,
  useConversationTeamChatAvailable,
} from "./useConversationComposer";

/**
 * Composer target toggle: Prompt (agent turn) vs Team chat (discussion
 * message). Hidden entirely on sessions without a cloud discussion plane.
 */
export function ConversationModePill({
  sessionId,
}: {
  sessionId: string | null;
}): React.ReactElement | null {
  const { t } = useTranslation("sessions");
  const available = useConversationTeamChatAvailable();
  const [mode, setMode] = useConversationComposerMode(sessionId);

  if (!available || !sessionId) return null;

  const teamChat = mode === "team_chat";
  return (
    <SelectorPill
      icon={
        teamChat ? (
          <HugeiconsIcon icon={MessagesSquare} size={14} strokeWidth={1.75} />
        ) : (
          <HugeiconsIcon icon={Bot} size={14} strokeWidth={1.75} />
        )
      }
      label={
        teamChat ? t("conversation.teamChatMode") : t("conversation.promptMode")
      }
      tooltip={
        teamChat
          ? t("conversation.teamChatTooltip")
          : t("conversation.promptTooltip")
      }
      tooltipFramed
      tooltipPosition="top"
      active={teamChat}
      dataTestId="conversation-mode-pill"
      onClick={() => setMode(teamChat ? "prompt" : "team_chat")}
      size="sm"
    />
  );
}
