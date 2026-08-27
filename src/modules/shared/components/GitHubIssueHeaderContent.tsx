import CheckCircle2 from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import CircleDot from "@hugeicons/core-free-icons/CircleIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React from "react";

import type { GitHubIssue } from "@src/api/tauri/github";

import GitHubDetailHeaderContent from "./GitHubDetailHeaderContent";

export type GitHubIssueHeader = Pick<GitHubIssue, "state" | "title"> &
  Partial<Pick<GitHubIssue, "number">>;

function IssueStateIcon({ isOpen }: { isOpen: boolean }): React.ReactNode {
  if (isOpen)
    return <HugeiconsIcon icon={CircleDot} size={14} strokeWidth={1.8} />;
  return <HugeiconsIcon icon={CheckCircle2} size={14} strokeWidth={1.8} />;
}

function getIssueStateClassName(issue: GitHubIssueHeader): string {
  return issue.state === "open" ? "text-success-6" : "text-purple-6";
}

/** Shared status, number, and title content for every GitHub issue header. */
const GitHubIssueHeaderContent: React.FC<{
  issue: GitHubIssueHeader | null;
  fallbackTitle?: string;
}> = ({ issue, fallbackTitle }) => {
  if (!issue) {
    return fallbackTitle ? (
      <GitHubDetailHeaderContent title={fallbackTitle} />
    ) : null;
  }

  return (
    <GitHubDetailHeaderContent
      number={issue.number}
      title={issue.title}
      status={
        <span className={`shrink-0 ${getIssueStateClassName(issue)}`}>
          <IssueStateIcon isOpen={issue.state === "open"} />
        </span>
      }
    />
  );
};

export default GitHubIssueHeaderContent;
