/**
 * ReplyInfoDisplay Component
 *
 * Display reply-to-question indicator with close button
 */
import X from "@hugeicons/core-free-icons/Cancel01Icon";
import Reply from "@hugeicons/core-free-icons/MailReply01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import UserActionButton from "./UserActionButton";

// ============================================
// Type Definitions
// ============================================

interface ReplyInfoDisplayProps {
  /** Reply info state */
  replyInfo: {
    isReply: boolean;
  };
  /** Handler to close reply mode */
  onClose: () => void;
}

// ============================================
// Component
// ============================================

const ReplyInfoDisplay: React.FC<ReplyInfoDisplayProps> = memo(
  ({ replyInfo, onClose }) => {
    const { t } = useTranslation("sessions");

    if (!replyInfo.isReply) {
      return null;
    }

    return (
      <UserActionButton
        leftIcon={<HugeiconsIcon icon={Reply} size={16} strokeWidth={1.75} />}
        title={t("chat.replyToQuestion")}
        rightIcon={<HugeiconsIcon icon={X} size={16} strokeWidth={1.75} />}
        onClick={() => onClose()}
      />
    );
  }
);

ReplyInfoDisplay.displayName = "ReplyInfoDisplay";

export default ReplyInfoDisplay;
