/**
 * Read-only pill primitives for rendered user messages.
 *
 * The inline pills UserMessageContent draws for each non-text segment:
 * the icon switch, the session-backed icon/label pair that resolves live
 * store data, the clickable file/terminal/link pill, and the member mention.
 */
import { useAtomValue } from "jotai";
import {
  AtSign,
  Code,
  Folder,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  Globe,
  Link,
  ListChecks,
  MousePointer2,
  SquareMousePointer,
  Terminal,
  Toolbox,
} from "lucide-react";
import React, { memo, useCallback, useMemo } from "react";

import GitHubPillIcon from "@src/assets/modelIcons/github-pill.svg";
import BasePill from "@src/components/ComposerInput/BasePill";
import CanvasCommandPillIcon, {
  isCanvasCommandPillPath,
} from "@src/components/ComposerInput/CanvasCommandPillIcon";
import { isGitHubPillUrl } from "@src/components/ComposerInput/githubUrl";
import { truncateVisiblePillLabel } from "@src/components/ComposerInput/utils";
import FileTypeIcon from "@src/components/FileTypeIcon";
import { PILL_SIZE } from "@src/config/pillTokens";
import type { PillType } from "@src/config/pillTokens";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { openExternalLink } from "@src/util/platform/ipcRenderer";
import { resolveSessionRowIcon } from "@src/util/session/sessionSidebarRow";

import {
  type MentionSegment,
  type PillSegment,
  sessionIdFromPillPath,
} from "./userMessageSegments";

// ============================================
// Pill Icon
// ============================================

const ICON_PROPS = { size: PILL_SIZE.iconSize, strokeWidth: 1.75 } as const;

const PillIcon: React.FC<{
  pillType: PillType;
  displayName: string;
  path: string;
}> = memo(function PillIcon({ pillType, displayName, path }) {
  if (isGitHubPillUrl(path)) {
    return (
      <GitHubPillIcon
        width={PILL_SIZE.iconSize}
        height={PILL_SIZE.iconSize}
        className="text-primary-6"
      />
    );
  }

  switch (pillType) {
    case "repo":
      return <Code {...ICON_PROPS} />;
    case "folder":
      return <Folder {...ICON_PROPS} />;
    case "branch":
      return <GitBranch {...ICON_PROPS} />;
    case "terminal":
      return <Terminal {...ICON_PROPS} />;
    case "session":
      return <SessionPillIcon path={path} />;
    case "browser":
      return <Globe {...ICON_PROPS} />;
    case "link":
      return <Link {...ICON_PROPS} />;
    case "dom-element":
      return <SquareMousePointer {...ICON_PROPS} />;
    case "dom-component":
      return <MousePointer2 {...ICON_PROPS} />;
    case "project":
      return <FolderKanban {...ICON_PROPS} />;
    case "workitem":
    case "issue":
      return <ListChecks {...ICON_PROPS} />;
    case "skill":
      if (isCanvasCommandPillPath(path)) {
        return <CanvasCommandPillIcon />;
      }
      return <Toolbox {...ICON_PROPS} />;
    case "pr":
      return <GitPullRequest {...ICON_PROPS} />;
    default:
      return <FileTypeIcon fileName={displayName} size="small" />;
  }
});
PillIcon.displayName = "PillIcon";

// ============================================
// Inline Pill (read-only, clickable)
// ============================================

const SessionPillIcon: React.FC<{ path: string }> = memo(({ path }) => {
  const sessionId = sessionIdFromPillPath(path);
  const session = useAtomValue(sessionByIdAtom(sessionId));
  const Icon = useMemo(
    () => resolveSessionRowIcon(session ?? sessionId),
    [session, sessionId]
  );
  return React.createElement(Icon, ICON_PROPS);
});
SessionPillIcon.displayName = "SessionPillIcon";

/**
 * Session pill labels resolve the LIVE session name from the store instead
 * of trusting the serialized token: the `displayName [type:path]` grammar
 * is single-token only, so multi-word session titles cannot round-trip
 * through it (they used to render as the last token, e.g. "啊p…").
 */
const SessionPillLabel: React.FC<{ path: string; fallback: string }> = memo(
  ({ path, fallback }) => {
    const session = useAtomValue(sessionByIdAtom(sessionIdFromPillPath(path)));
    const label = session?.name?.trim() || fallback;
    return <span>{truncateVisiblePillLabel(label)}</span>;
  }
);
SessionPillLabel.displayName = "SessionPillLabel";

export const InlinePill: React.FC<{ segment: PillSegment }> = memo(
  ({ segment }) => {
    const isGitHubUrl = isGitHubPillUrl(segment.path);
    const isGenericLink = segment.pillType === "link";
    const isClickable =
      isGitHubUrl ||
      isGenericLink ||
      segment.pillType === "terminal" ||
      segment.pillType === "file" ||
      segment.pillType === "folder" ||
      segment.pillType === "dom-component" ||
      segment.pillType === "paste";

    const handleClick = useCallback(
      (e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (isGitHubUrl || isGenericLink) {
          void openExternalLink(segment.path);
          return;
        }

        if (segment.pillType === "terminal") {
          let sessionId: string;
          if (segment.path.startsWith("terminal://")) {
            const parts = segment.path.replace("terminal://", "").split("/");
            sessionId = parts[0];
          } else {
            sessionId = segment.path;
          }

          const terminalText =
            segment.terminalText ??
            window.__orgiiTerminalPillTexts?.[segment.path] ??
            undefined;

          document.dispatchEvent(
            new CustomEvent("terminal-pill-click", {
              detail: {
                sessionId,
                fileName: segment.displayName,
                terminalText,
              },
            })
          );
          return;
        }

        if (
          segment.pillType === "paste" ||
          segment.pillType === "dom-component"
        ) {
          // Route to the dedicated DomComponentPreview tab (Raw / Preview viewer).
          const pasteText =
            segment.terminalText ??
            window.__orgiiTerminalPillTexts?.[segment.path] ??
            "";
          document.dispatchEvent(
            new CustomEvent("dom-component-preview-click", {
              detail: {
                pasteId: segment.path,
                fileName: segment.displayName,
                jsonText: pasteText,
              },
            })
          );
          return;
        }

        if (segment.pillType === "file" || segment.pillType === "folder") {
          document.dispatchEvent(
            new CustomEvent("file-pill-click", {
              detail: {
                filePath: segment.path,
                fileName: segment.displayName,
                isFolder: segment.pillType === "folder",
              },
            })
          );
        }
      },
      [isGenericLink, isGitHubUrl, segment]
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent) => {
        if (!isClickable || (event.key !== "Enter" && event.key !== " "))
          return;
        handleClick(event);
      },
      [handleClick, isClickable]
    );

    /** Prevent mousedown from triggering text-selection or parent click */
    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (isClickable) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      [isClickable]
    );

    const visibleDisplayName = useMemo(
      () =>
        isGitHubUrl || isGenericLink
          ? segment.displayName
          : truncateVisiblePillLabel(segment.displayName),
      [isGenericLink, isGitHubUrl, segment.displayName]
    );

    return (
      <BasePill
        variant="editor"
        className={
          isClickable
            ? "underline-offset-2 hover:underline focus-visible:underline active:underline"
            : undefined
        }
        iconNode={
          <PillIcon
            pillType={segment.pillType}
            displayName={segment.displayName}
            path={segment.path}
          />
        }
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        style={{
          cursor: isClickable
            ? "var(--interactive-cursor, default)"
            : "default",
          position: "relative",
          zIndex: 1,
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onClick={isClickable ? handleClick : undefined}
        onKeyDown={isClickable ? handleKeyDown : undefined}
        onMouseDown={handleMouseDown}
        title={segment.displayName}
      >
        {segment.pillType === "session" ? (
          <SessionPillLabel
            path={segment.path}
            fallback={segment.displayName}
          />
        ) : (
          <span>{visibleDisplayName}</span>
        )}
      </BasePill>
    );
  }
);
InlinePill.displayName = "InlinePill";

export const MentionPill: React.FC<{ segment: MentionSegment }> = memo(
  function MentionPill({ segment }) {
    return (
      <BasePill
        variant="editor"
        iconNode={<AtSign {...ICON_PROPS} />}
        style={{
          position: "relative",
          zIndex: 1,
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        title={segment.displayName}
      >
        <span>{segment.displayName}</span>
      </BasePill>
    );
  }
);
