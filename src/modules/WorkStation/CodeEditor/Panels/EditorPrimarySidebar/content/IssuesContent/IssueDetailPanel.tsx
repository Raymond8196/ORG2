import { CheckCircle2, CircleDot, Globe } from "lucide-react";
import React, { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  GitHubIssue,
  GitHubIssueTimelineItem,
} from "@src/api/tauri/github";
import Button from "@src/components/Button";
import IntegrationIcon from "@src/components/IntegrationIcon";
import { ISSUE_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import {
  HEADER_CLASSES,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import { CloudSessionReferencePreview } from "@src/features/Org2Cloud/CloudSessionReferencePreview";
import { useSessionReferenceDropTarget } from "@src/features/Org2Cloud/useSessionReferenceDropTarget";
import { GitHubIssueThreadSurface } from "@src/modules/ProjectManager/WorkItems/components";
import type { WorkItemExternalAssigneeConfig } from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties/types";
import RichMarkdownEditor from "@src/modules/shared/components/RichMarkdownEditor";
import type { RichMarkdownEditorRef } from "@src/modules/shared/components/RichMarkdownEditor";

interface IssueDetailPanelProps {
  issue: GitHubIssue;
  timeline: GitHubIssueTimelineItem[];
  timelineLoading: boolean;
  submittingComment: boolean;
  showHeader?: boolean;
  onCloseIssue: () => void;
  onReopenIssue: () => void;
  onAddComment: (body: string) => Promise<void>;
  assigneeConfig?: WorkItemExternalAssigneeConfig;
}

function IssueStateIcon({ isOpen }: { isOpen: boolean }): React.ReactNode {
  if (isOpen) return <CircleDot size={14} strokeWidth={1.8} />;
  return <CheckCircle2 size={14} strokeWidth={1.8} />;
}

function getIssueStateClassName(issue: GitHubIssue): string {
  return issue.state === "open" ? "text-success-6" : "text-purple-6";
}

export function getIssueDetailTitle(issue: GitHubIssue): string {
  return `#${issue.number} ${issue.title}`;
}

export function IssueDetailHeaderContent({
  issue,
  fallbackTitle,
}: {
  issue: GitHubIssue | null;
  fallbackTitle?: string;
}): React.ReactNode {
  if (!issue) {
    return fallbackTitle ? (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <IntegrationIcon
          type="github"
          size={HEADER_ICON_SIZE.sm}
          className="shrink-0"
        />
        <span className="min-w-0 select-text truncate text-[13px] font-medium text-text-1">
          {fallbackTitle}
        </span>
      </span>
    ) : null;
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <IntegrationIcon
        type="github"
        size={HEADER_ICON_SIZE.sm}
        className="shrink-0"
      />
      <span className={`shrink-0 ${getIssueStateClassName(issue)}`}>
        <IssueStateIcon isOpen={issue.state === "open"} />
      </span>
      <span className="shrink-0 select-text text-[11px] text-text-3">
        #{issue.number}
      </span>
      <span
        className="min-w-0 flex-1 select-text truncate text-[13px] font-medium text-text-1"
        title={issue.title}
      >
        {issue.title}
      </span>
    </span>
  );
}

export function IssueDetailExternalLinkButton({
  issue,
  title = "Open on GitHub",
}: {
  issue: GitHubIssue;
  title?: string;
}): React.ReactNode {
  return (
    <Button
      href={issue.html_url}
      target="_blank"
      rel="noopener noreferrer"
      variant="tertiary"
      size="small"
      iconOnly
      icon={<Globe size={HEADER_ICON_SIZE.sm} strokeWidth={1.75} />}
      title={title}
      aria-label={title}
    />
  );
}

export const IssueDetailPanel: React.FC<IssueDetailPanelProps> = memo(
  ({
    issue,
    timeline,
    timelineLoading,
    submittingComment,
    showHeader = true,
    onCloseIssue,
    onReopenIssue,
    onAddComment,
    assigneeConfig,
  }) => {
    const { t } = useTranslation("common");
    const [commentBody, setCommentBody] = useState("");
    const commentEditorRef = useRef<RichMarkdownEditorRef>(null);
    const commentDropTargetRef = useRef<HTMLDivElement>(null);
    const insertDroppedReference = useCallback(
      (text: string, dropPoint?: { clientX: number; clientY: number }) => {
        commentEditorRef.current?.insertText(text, {
          separateFromAdjacentText: true,
          clientX: dropPoint?.clientX,
          clientY: dropPoint?.clientY,
        });
      },
      []
    );
    const { isDragOver: commentDragOver } = useSessionReferenceDropTarget({
      elementRef: commentDropTargetRef,
      onInsertText: insertDroppedReference,
    });
    const isOpen = issue.state === "open";

    const handleCommentSubmit = useCallback(async () => {
      const body = commentBody.trim();
      if (!body || submittingComment) return;
      await onAddComment(body);
      setCommentBody("");
    }, [commentBody, submittingComment, onAddComment]);
    const handleStatusChange = useCallback(
      (status: GitHubIssue["state"]) => {
        if (status === issue.state) return;
        if (status === "open") {
          onReopenIssue();
        } else {
          onCloseIssue();
        }
      },
      [issue.state, onCloseIssue, onReopenIssue]
    );

    return (
      <div className="allow-select-deep flex h-full min-h-0 select-text flex-col overflow-hidden">
        {showHeader && (
          <div className={HEADER_CLASSES.pageHeader}>
            <IssueDetailHeaderContent issue={issue} />
            <IssueDetailExternalLinkButton issue={issue} />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <GitHubIssueThreadSurface
            issue={issue}
            timeline={timeline}
            timelineLoading={timelineLoading}
            onStatusChange={handleStatusChange}
            assigneeConfig={assigneeConfig}
          />
        </div>

        <div className="bg-surface-1 flex-shrink-0 border-t border-border-1 px-4 py-3">
          <div
            className={`${ISSUE_PANEL_WIDTH_TOKENS.headerWidth} flex flex-col gap-2`}
          >
            <div
              ref={commentDropTargetRef}
              className={`rounded-md ${
                commentDragOver ? "ring-2 ring-primary-6" : ""
              }`.trim()}
              data-testid="issue-comment-drop-target"
            >
              <RichMarkdownEditor
                ref={commentEditorRef}
                value={commentBody}
                onChange={(markdown) => setCommentBody(markdown)}
                placeholder={t(
                  "git.issues.commentPlaceholder",
                  "Leave a comment…"
                )}
                minHeight={64}
                maxHeight={180}
                appearance="outlined"
                onSubmit={() => void handleCommentSubmit()}
                dataTestId="issue-comment-editor"
              />
            </div>
            <CloudSessionReferencePreview text={commentBody} />
            <div className="flex min-h-9 items-center justify-between gap-1 px-1">
              {isOpen ? (
                <Button
                  htmlType="button"
                  variant="secondary"
                  appearance="outline"
                  size="small"
                  shape="round"
                  onClick={onCloseIssue}
                >
                  Close issue
                </Button>
              ) : (
                <Button
                  htmlType="button"
                  variant="secondary"
                  appearance="outline"
                  size="small"
                  shape="round"
                  onClick={onReopenIssue}
                >
                  Reopen issue
                </Button>
              )}
              <Button
                htmlType="button"
                variant="primary"
                size="small"
                shape="round"
                loading={submittingComment}
                disabled={!commentBody.trim() || submittingComment}
                onClick={() => void handleCommentSubmit()}
              >
                {t("git.issues.submitComment", "Comment")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

IssueDetailPanel.displayName = "IssueDetailPanel";
