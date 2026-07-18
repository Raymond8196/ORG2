import React, { memo } from "react";
import { useTranslation } from "react-i18next";

export interface SessionRawTranscriptContentProps {
  actions?: React.ReactNode;
  entryCount: number;
  error: string | null;
  loaded: boolean;
  loading: boolean;
  sourceLabel: string;
  transcriptJson: string;
}

const SessionRawTranscriptContent: React.FC<SessionRawTranscriptContentProps> =
  memo(
    ({
      actions,
      entryCount,
      error,
      loaded,
      loading,
      sourceLabel,
      transcriptJson,
    }) => {
      const { t } = useTranslation(["sessions", "common"]);

      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-7 items-center gap-2 text-xs text-text-3">
            <div className="flex min-w-0 items-center gap-2">
              {sourceLabel ? (
                <span className="truncate">{sourceLabel}</span>
              ) : null}
              {loaded ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    {t("chat.rawTranscript.entryCount", {
                      count: entryCount,
                      defaultValue: "{{count}} entries",
                    })}
                  </span>
                </>
              ) : null}
            </div>
            {actions ? (
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {actions}
              </div>
            ) : null}
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-danger-6/40 bg-danger-1 px-3 py-2 text-sm text-danger-6"
            >
              {error}
            </div>
          ) : null}
          <textarea
            readOnly
            spellCheck={false}
            aria-label={t("chat.rawTranscript.title", {
              defaultValue: "Raw session transcript",
            })}
            value={
              loading && !loaded
                ? t("common:status.loading", { defaultValue: "Loading…" })
                : transcriptJson
            }
            className="min-h-0 flex-1 resize-none rounded-md border border-border-2 bg-fill-1 p-3 font-mono text-xs leading-5 text-text-1 outline-none focus:border-primary-6"
          />
        </div>
      );
    }
  );

SessionRawTranscriptContent.displayName = "SessionRawTranscriptContent";

export default SessionRawTranscriptContent;
