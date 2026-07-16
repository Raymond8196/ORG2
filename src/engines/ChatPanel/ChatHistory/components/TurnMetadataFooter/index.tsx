import { useSetAtom } from "jotai";
import {
  BookOpenText,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  GitPullRequest,
  MoreHorizontal,
  Search,
} from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import StackRowButton from "@src/components/StackRowButton";
import TextButton from "@src/components/TextButton";
import {
  CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS,
  CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS,
  COMPOSER_STACK_ROW_BASE,
} from "@src/config/composerStackTokens";
import FileChangeRow from "@src/engines/ChatPanel/InputArea/components/FileChangeRow";
import { replayModeAtom } from "@src/engines/SessionCore";
import type { ExtractedGitArtifactData } from "@src/engines/SessionCore/core/types";
import type {
  TurnResourceInteraction,
  TurnSummary,
} from "@src/engines/SessionCore/storage/sqliteCache";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanelAtom";
import {
  STATION_MODE,
  bumpSimulatorDiffRefreshNonceAtom,
  simulatorDiffCommitNavigationRequestAtom,
  simulatorDiffScopeRequestAtom,
  simulatorSelectedAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";
import { openExternalLink } from "@src/util/platform/ipcRenderer";

import { mapTurnModifiedFilesToFileChanges } from "./turnFilesMapping";

const DEFAULT_VISIBLE_FILES = 4;
let diffScopeNonce = 0;

export interface TurnMetadataFooterProps {
  summary: TurnSummary;
  sessionId: string;
  turnId: string;
  isPagedHistoryRound?: boolean;
}

function artifactLabel(artifact: ExtractedGitArtifactData): string {
  if (artifact.kind === "pullRequest") {
    return artifact.prTitle || `#${artifact.prNumber ?? "?"}`;
  }
  return artifact.subject || artifact.shortSha || artifact.sha || "Commit";
}

const TurnMetadataFooter: React.FC<TurnMetadataFooterProps> = memo(
  ({ summary, sessionId, turnId, isPagedHistoryRound = false }) => {
    const { t } = useTranslation("sessions");
    const [expanded, setExpanded] = useState(false);
    const setStationMode = useSetAtom(stationModeAtom);
    const setSelectedSimulatorApp = useSetAtom(simulatorSelectedAppAtom);
    const setReplayMode = useSetAtom(replayModeAtom);
    const setChatPanelMaximized = useSetAtom(chatPanelMaximizedAtom);
    const setDiffScope = useSetAtom(simulatorDiffScopeRequestAtom);
    const setCommitNavigation = useSetAtom(
      simulatorDiffCommitNavigationRequestAtom
    );
    const refreshDiff = useSetAtom(bumpSimulatorDiffRefreshNonceAtom);

    const files = useMemo(
      () => mapTurnModifiedFilesToFileChanges(summary.modifiedFiles),
      [summary.modifiedFiles]
    );
    const commits = useMemo(
      () => summary.gitArtifacts.filter((item) => item.kind === "commit"),
      [summary.gitArtifacts]
    );
    const pullRequests = useMemo(
      () => summary.gitArtifacts.filter((item) => item.kind === "pullRequest"),
      [summary.gitArtifacts]
    );
    const observedResources = useMemo(
      () =>
        summary.resourceInteractions.filter(
          (item) => item.action === "read" || item.action === "search"
        ),
      [summary.resourceInteractions]
    );
    const readCount = useMemo(
      () =>
        observedResources
          .filter((item) => item.action === "read")
          .reduce((total, item) => total + item.count, 0),
      [observedResources]
    );
    const searchCount = useMemo(
      () =>
        observedResources
          .filter((item) => item.action === "search")
          .reduce((total, item) => total + item.count, 0),
      [observedResources]
    );

    const openDiff = useCallback(
      (selectedPath?: string | null) => {
        setDiffScope({
          sessionId,
          turnId,
          filePaths: files.map((file) => file.path),
          selectedPath: selectedPath ?? null,
          nonce: ++diffScopeNonce,
        });
        refreshDiff();
        setChatPanelMaximized(false);
        setStationMode(STATION_MODE.AGENT_STATION);
        setSelectedSimulatorApp(AppType.DIFF);
        setReplayMode("replay");
      },
      [
        files,
        refreshDiff,
        sessionId,
        setChatPanelMaximized,
        setDiffScope,
        setReplayMode,
        setSelectedSimulatorApp,
        setStationMode,
        turnId,
      ]
    );

    const openCommit = useCallback(
      (artifact: ExtractedGitArtifactData) => {
        const commitSha = artifact.sha ?? artifact.shortSha;
        if (!commitSha) return;
        setChatPanelMaximized(false);
        setStationMode(STATION_MODE.AGENT_STATION);
        setSelectedSimulatorApp(AppType.DIFF);
        setReplayMode("replay");
        setCommitNavigation({
          sessionId,
          commitSha,
          nonce: Date.now(),
        });
      },
      [
        sessionId,
        setChatPanelMaximized,
        setCommitNavigation,
        setReplayMode,
        setSelectedSimulatorApp,
        setStationMode,
      ]
    );

    const openPullRequest = useCallback(
      (artifact: ExtractedGitArtifactData) => {
        if (!artifact.url) return;
        void openExternalLink(artifact.url).catch(() => {
          Message.error(t("cards.url.openExternalFailed"));
        });
      },
      [t]
    );

    const visibleFiles = expanded
      ? files
      : files.slice(0, DEFAULT_VISIBLE_FILES);
    const visibleResources = expanded
      ? observedResources
      : observedResources.slice(
          0,
          Math.max(0, DEFAULT_VISIBLE_FILES - visibleFiles.length)
        );
    const hiddenCount =
      files.length +
      observedResources.length -
      visibleFiles.length -
      visibleResources.length;
    const isSettled =
      summary.status !== "pending" && summary.status !== "working";

    if (
      files.length === 0 &&
      observedResources.length === 0 &&
      summary.gitArtifacts.length === 0
    ) {
      if (!isSettled) return null;
      return (
        <div className="px-3 pt-2" data-testid="turn-metadata-empty">
          <div
            className={`${CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS} flex h-8 items-center gap-2 rounded-lg border border-solid border-border-2 px-2.5 text-[12px] text-text-3`}
          >
            <FileCode2 size={14} />
            {t("chat.turnMetadata.noChanges")}
          </div>
        </div>
      );
    }

    return (
      <div className="px-3 pt-2" data-testid="turn-metadata-footer">
        <div
          className={`${CHAT_COMPOSER_STACK_BAR_SURFACE_BG_CLASS} overflow-hidden rounded-lg border border-solid border-border-2`}
        >
          <div className="flex min-h-8 items-center justify-between gap-2 px-2.5 py-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-2">
              {isPagedHistoryRound && (
                <span className="text-text-3">
                  {t("chat.turnMetadata.earlierRound")}
                </span>
              )}
              {files.length > 0 && (
                <span
                  className="flex items-center gap-1"
                  data-testid="turn-metadata-files-count"
                >
                  <FileCode2 size={13} />
                  {t("chat.turnMetadata.files", { count: files.length })}
                </span>
              )}
              {readCount > 0 && (
                <span
                  className="flex items-center gap-1"
                  data-testid="turn-metadata-reads-count"
                >
                  <BookOpenText size={13} />
                  {t("chat.turnMetadata.reads", { count: readCount })}
                </span>
              )}
              {searchCount > 0 && (
                <span
                  className="flex items-center gap-1"
                  data-testid="turn-metadata-searches-count"
                >
                  <Search size={13} />
                  {t("chat.turnMetadata.searches", { count: searchCount })}
                </span>
              )}
              {commits.length > 0 && (
                <span
                  className="flex items-center gap-1"
                  data-testid="turn-metadata-commits-count"
                >
                  <GitCommitHorizontal size={13} />
                  {t("chat.turnMetadata.commits", { count: commits.length })}
                </span>
              )}
              {pullRequests.length > 0 && (
                <span
                  className="flex items-center gap-1"
                  data-testid="turn-metadata-prs-count"
                >
                  <GitPullRequest size={13} />
                  {t("chat.turnMetadata.pullRequests", {
                    count: pullRequests.length,
                  })}
                </span>
              )}
            </div>
            {files.length > 0 && (
              <TextButton
                onClick={() => openDiff()}
                className="shrink-0 text-[12px] text-text-3 hover:text-text-1"
              >
                {t("chat.turnMetadata.review")}
              </TextButton>
            )}
          </div>

          <div
            className={`${CHAT_COMPOSER_STACK_BAR_INNER_PADDING_X_CLASS} max-h-[320px] overflow-y-auto pb-1`}
          >
            {commits.map((artifact) => (
              <StackRowButton
                key={`commit-${artifact.sha ?? artifact.url}`}
                onClick={() => openCommit(artifact)}
                disabled={!artifact.sha && !artifact.shortSha}
                title={artifact.sha ?? artifact.url}
                data-testid="turn-metadata-commit"
              >
                <GitCommitHorizontal size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-2">
                  {artifactLabel(artifact)}
                </span>
                {artifact.shortSha && (
                  <span className="shrink-0 font-mono text-[11px] text-text-3">
                    {artifact.shortSha}
                  </span>
                )}
              </StackRowButton>
            ))}
            {pullRequests.map((artifact) => (
              <StackRowButton
                key={`pr-${artifact.url ?? artifact.prNumber}`}
                onClick={() => openPullRequest(artifact)}
                disabled={!artifact.url}
                title={artifact.url}
                data-testid="turn-metadata-pr"
              >
                <GitPullRequest size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-2">
                  {artifactLabel(artifact)}
                </span>
                <ExternalLink size={12} className="shrink-0 text-text-3" />
              </StackRowButton>
            ))}
            {visibleResources.map((interaction: TurnResourceInteraction) => {
              const isRead = interaction.action === "read";
              const Icon = isRead ? BookOpenText : Search;
              return (
                <div
                  key={`${interaction.action}-${interaction.outcome}-${interaction.path}`}
                  className={COMPOSER_STACK_ROW_BASE}
                  title={interaction.path}
                  data-testid={`turn-metadata-${interaction.action}`}
                >
                  <Icon size={14} className="shrink-0 text-text-3" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-text-2">
                    {interaction.path}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-3">
                    {interaction.outcome === "failed"
                      ? t("chat.turnMetadata.failed")
                      : interaction.count > 1
                        ? `×${interaction.count}`
                        : t(
                            isRead
                              ? "chat.turnMetadata.reads"
                              : "chat.turnMetadata.searches",
                            { count: 1 }
                          )}
                  </span>
                </div>
              );
            })}
            {visibleFiles.map((file) => (
              <FileChangeRow
                key={file.path}
                file={file}
                onFileClick={openDiff}
              />
            ))}
            {hiddenCount > 0 || expanded ? (
              <StackRowButton
                onClick={() => setExpanded((previous) => !previous)}
                className="text-text-3"
              >
                <MoreHorizontal size={14} className="shrink-0" />
                <span className="chat-block-title truncate">
                  {expanded
                    ? t("chat.turnMetadata.showLess")
                    : t("chat.turnMetadata.showMore", { count: hiddenCount })}
                </span>
              </StackRowButton>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);

TurnMetadataFooter.displayName = "TurnMetadataFooter";

export default TurnMetadataFooter;
