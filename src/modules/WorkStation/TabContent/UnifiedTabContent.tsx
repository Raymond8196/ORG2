/**
 * UnifiedTabContent — single dispatcher component for all WorkStation
 * tab content. Resolves `tab.type` to a lazy renderer (via
 * `rendererComponents.ts`) and renders it inside a `Suspense` boundary (so
 * switching between two already-loaded tabs of the same chunk does
 * not re-suspend).
 *
 * CodeEditor mounts this dispatcher for registry-owned tabs that do not
 * need host-coupled editor props; other hosts can mount it directly as
 * their adapters are retired.
 *
 * The renderer is wrapped in `TabErrorBoundary` so a chunk that fails every
 * retry costs one tab rather than the whole `/orgii` route. Retrying evicts the
 * cached lazy component and bumps `generation`, which both rebuilds the
 * component and remounts the boundary.
 */
import React, { Suspense, memo, useCallback, useMemo, useState } from "react";

import GitHubDetailSkeleton from "@src/modules/shared/components/GitHubDetailSkeleton";
import type { WorkStationTab } from "@src/store/workstation/tabs/types";

import { TabErrorBoundary } from "./TabErrorBoundary";
import { TabLoadingPlaceholder } from "./TabLoadingPlaceholder";
import { UnknownTabPlaceholder } from "./UnknownTabPlaceholder";
import {
  getRendererComponent,
  invalidateRendererComponents,
} from "./rendererComponents";

export interface UnifiedTabContentDispatcherProps {
  tab: WorkStationTab;
  paneId: string;
  isActive: boolean;
}

export const UnifiedTabContent: React.FC<UnifiedTabContentDispatcherProps> =
  memo(({ tab, paneId, isActive }) => {
    const [generation, setGeneration] = useState(0);

    const Component = useMemo(
      () => getRendererComponent(tab.type),
      // `generation` is the retry seam: bumping it discards the memo so a fresh
      // lazy component is built from the registry factory.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tab.type, generation]
    );

    const handleRetry = useCallback(() => {
      invalidateRendererComponents(tab.type);
      setGeneration((current) => current + 1);
    }, [tab.type]);

    if (!Component) {
      return <UnknownTabPlaceholder type={tab.type} />;
    }

    const fallback =
      tab.type === "github-issue-detail" ? (
        <GitHubDetailSkeleton kind="issue" showHeader={false} />
      ) : tab.type === "github-pr-detail" ? (
        <GitHubDetailSkeleton kind="pr" showHeader={false} />
      ) : (
        <TabLoadingPlaceholder />
      );

    return (
      <TabErrorBoundary
        key={`${tab.type}:${generation}`}
        tabId={tab.id}
        tabType={tab.type}
        onRetry={handleRetry}
      >
        <Suspense fallback={fallback}>
          <Component tab={tab} paneId={paneId} isActive={isActive} />
        </Suspense>
      </TabErrorBoundary>
    );
  });

UnifiedTabContent.displayName = "UnifiedTabContent";

export default UnifiedTabContent;
