import { Clipboard, RefreshCw } from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import SessionRawTranscriptContent from "@src/engines/ChatPanel/components/SessionRawTranscriptDialog/SessionRawTranscriptContent";
import { useSessionRawTranscript } from "@src/engines/ChatPanel/components/SessionRawTranscriptDialog/useSessionRawTranscript";

export interface SessionRawTranscriptViewProps {
  sessionId: string;
}

const SessionRawTranscriptView: React.FC<SessionRawTranscriptViewProps> = memo(
  ({ sessionId }) => {
    const { t } = useTranslation(["sessions", "common"]);
    const transcript = useSessionRawTranscript(sessionId);
    const refreshLabel = t("common:actions.refresh", "Refresh");
    const copyLabel = t("common:actions.copy", "Copy");

    return (
      <div
        data-testid="workstation-session-raw-view"
        className="flex min-h-0 flex-1 flex-col p-3"
      >
        <SessionRawTranscriptContent
          actions={
            <>
              <Button
                size="mini"
                variant="tertiary"
                appearance="ghost"
                icon={<RefreshCw size={14} strokeWidth={1.75} />}
                iconOnly
                loading={transcript.loading}
                aria-label={refreshLabel}
                title={refreshLabel}
                onClick={() => void transcript.loadTranscript()}
              />
              <Button
                size="mini"
                variant="tertiary"
                appearance="ghost"
                icon={<Clipboard size={14} strokeWidth={1.75} />}
                iconOnly
                disabled={!transcript.snapshot || transcript.loading}
                aria-label={copyLabel}
                title={copyLabel}
                onClick={() => void transcript.copyTranscript()}
              />
            </>
          }
          entryCount={transcript.entries.length}
          error={transcript.error}
          loaded={Boolean(transcript.snapshot)}
          loading={transcript.loading}
          sourceLabel={transcript.sourceLabel}
          transcriptJson={transcript.transcriptJson}
        />
      </div>
    );
  }
);

SessionRawTranscriptView.displayName = "SessionRawTranscriptView";

export default SessionRawTranscriptView;
