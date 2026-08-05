/**
 * Renderer for `github-pr-detail` tabs.
 *
 * Reconstructs a `PrIdentity` from the tab data and delegates to the existing
 * Source Control `PrDetailPanel`, which self-loads the full PR (Conversation /
 * Commits / Checks / Changes) via `useWorkstationPrDetail`. The panel renders
 * its compact PR identity into the shared 40px tab-header strip while the PR
 * body fills the main pane without a second header.
 */
import React, { memo, useCallback, useMemo } from "react";

import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs/useWorkStationTabs";
import {
  PrDetailExternalLinkButton,
  PrDetailHeaderContent,
  PrDetailPanel,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/PullRequestContent/detail/PrDetailPanel";
import type { PrIdentity } from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { createFileTab } from "@src/store/workstation/tabs";
import type { GitHubPrDetailTabData } from "@src/store/workstation/tabs";

import type { UnifiedTabContentProps } from "../types";

const GitHubPrDetailTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const tabData = tab.data as unknown as GitHubPrDetailTabData;
    const { openTab } = useWorkStationTabs();

    const handleFileSelect = useCallback(
      (path: string) => {
        const absolutePath =
          path.startsWith("/") || !tabData.repoPath
            ? path
            : `${tabData.repoPath}/${path}`;
        openTab(createFileTab(absolutePath));
      },
      [openTab, tabData.repoPath]
    );

    const identity = useMemo<PrIdentity>(
      () => ({
        number: tabData.prNumber,
        title: tabData.prTitle,
        url: tabData.prUrl,
        status: tabData.prStatus,
        headBranch: tabData.headBranch,
        baseBranch: tabData.baseBranch,
      }),
      [
        tabData.prNumber,
        tabData.prTitle,
        tabData.prUrl,
        tabData.prStatus,
        tabData.headBranch,
        tabData.baseBranch,
      ]
    );

    const headerContent = useMemo(
      () => (
        <span className="flex h-10 min-w-0 flex-1 items-center gap-2">
          <PrDetailHeaderContent identity={identity} />
        </span>
      ),
      [identity]
    );

    const headerTrailing = useMemo(
      () => <PrDetailExternalLinkButton identity={identity} />,
      [identity]
    );

    usePublishWorkstationTabHeader({
      host: "code",
      content: {
        content: headerContent,
        trailing: headerTrailing,
        sidebarToggleDisabled: true,
        joinWithFollowingRow: true,
      },
    });

    return (
      <PrDetailPanel
        identity={identity}
        repoPath={tabData.repoPath}
        repoId={tabData.repoId}
        showHeader={false}
        onFileSelect={handleFileSelect}
      />
    );
  }
);

GitHubPrDetailTabRenderer.displayName = "GitHubPrDetailTabRenderer";

export default GitHubPrDetailTabRenderer;
