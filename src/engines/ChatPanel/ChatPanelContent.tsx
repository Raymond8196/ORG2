import React, { Suspense } from "react";

import type {
  ChatHistoryDisplayMode,
  ChatPanelSelectedCollabOrg,
  ChatPanelSelectedProject,
  ChatPanelSelectedProjectOrg,
  ChatPanelSelectedWorkItem,
  ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

import ChatView from "./ChatView";

const BenchmarkPanel = React.lazy(() =>
  import("@src/features/BenchmarkPanel").then((module) => ({
    default: module.BenchmarkPanel,
  }))
);
const CollabOrgPanelView = React.lazy(
  () => import("./panels/CollabOrgPanelView")
);
const ProjectOrgPanelView = React.lazy(
  () => import("./panels/ProjectOrgPanelView")
);
const ProjectPanelView = React.lazy(() => import("./panels/ProjectPanelView"));
const WorkItemPanelView = React.lazy(
  () => import("./panels/WorkItemPanelView")
);
const WorkspaceExplorePanelView = React.lazy(
  () => import("./panels/WorkspaceExplorePanelView")
);
const WorkspaceOverviewPanelView = React.lazy(
  () => import("./panels/WorkspaceOverviewPanelView")
);

interface ChatPanelContentProps {
  currentSessionId: string | null;
  emptyChatContent: React.ReactNode;
  handleRegisterSearchOpen: (handler: (() => void) | null) => void;
  displayMode: ChatHistoryDisplayMode;
  paginationEnabled: boolean;
  position: "left" | "right";
  selectedCollabOrg: ChatPanelSelectedCollabOrg | null;
  selectedProject: ChatPanelSelectedProject | null;
  selectedProjectOrg: ChatPanelSelectedProjectOrg | null;
  selectedWorkItem: ChatPanelSelectedWorkItem | null;
  selectedWorkspace: ChatPanelSelectedWorkspace | null;
  showBenchmarkSessionGroupContent: boolean;
  showCollabOrgContent: boolean;
  showExploreContent: boolean;
  showPanelContent: boolean;
  showProjectContent: boolean;
  showProjectOrgContent: boolean;
  showSessionContent: boolean;
  showWorkItemContent: boolean;
  showWorkspaceOverviewContent: boolean;
}

export function ChatPanelContent({
  currentSessionId,
  emptyChatContent,
  handleRegisterSearchOpen,
  displayMode,
  paginationEnabled,
  position,
  selectedCollabOrg,
  selectedProject,
  selectedProjectOrg,
  selectedWorkItem,
  selectedWorkspace,
  showBenchmarkSessionGroupContent,
  showCollabOrgContent,
  showExploreContent,
  showPanelContent,
  showProjectContent,
  showProjectOrgContent,
  showSessionContent,
  showWorkItemContent,
  showWorkspaceOverviewContent,
}: ChatPanelContentProps): React.ReactNode {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!showPanelContent ? null : showBenchmarkSessionGroupContent ? (
        <Suspense fallback={null}>
          <BenchmarkPanel surface="runList" />
        </Suspense>
      ) : showWorkItemContent && selectedWorkItem ? (
        <Suspense fallback={null}>
          <WorkItemPanelView selectedWorkItem={selectedWorkItem} />
        </Suspense>
      ) : showProjectContent && selectedProject ? (
        <Suspense fallback={null}>
          <ProjectPanelView selectedProject={selectedProject} />
        </Suspense>
      ) : showProjectOrgContent && selectedProjectOrg ? (
        <Suspense fallback={null}>
          <ProjectOrgPanelView selectedProjectOrg={selectedProjectOrg} />
        </Suspense>
      ) : showExploreContent ? (
        <Suspense fallback={null}>
          <WorkspaceExplorePanelView />
        </Suspense>
      ) : showCollabOrgContent && selectedCollabOrg ? (
        <Suspense fallback={null}>
          <CollabOrgPanelView selectedCollabOrg={selectedCollabOrg} />
        </Suspense>
      ) : showWorkspaceOverviewContent && selectedWorkspace ? (
        <Suspense fallback={null}>
          <WorkspaceOverviewPanelView selectedWorkspace={selectedWorkspace} />
        </Suspense>
      ) : showSessionContent && currentSessionId ? (
        <ChatView
          sessionId={currentSessionId}
          onRegisterSearchOpen={handleRegisterSearchOpen}
          displayMode={displayMode}
          turnPaginationEnabled={paginationEnabled}
          position={position}
        />
      ) : (
        emptyChatContent
      )}
    </div>
  );
}
