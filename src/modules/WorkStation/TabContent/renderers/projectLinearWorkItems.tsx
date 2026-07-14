/**
 * Renderer wrapper for `project-linear-work-items` tabs.
 *
 * Renders the Linear work-items surface (`LinearProjectsPage`) through the
 * unified dispatcher, pulling action callbacks from the hoisted Project host
 * context and deriving the Linear surface / breadcrumb from tab data —
 * mirroring the `LinearProjectsTabPane` logic in `ProjectManagerContentRouter`.
 * Default surface is WORK_ITEMS.
 */
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import LinearProjectsPage from "@src/modules/ProjectManager/LinearProjects";
import { ProjectLinearSurfacePillSwitch } from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectLinearSurfacePillSwitch";
import { getProjectManagerBreadcrumbSegments } from "@src/modules/ProjectManager/ProjectManagerLayout/components/projectManagerRouterUtils";
import { useProjectHostContext } from "@src/modules/ProjectManager/ProjectManagerLayout/context/projectHostContext";
import {
  PROJECT_LINEAR_SURFACE_VIEW,
  normalizeProjectLinearSurfaceView,
} from "@src/store/workstation/tabs";
import type { ProjectLinearSurfaceView } from "@src/store/workstation/tabs";

import type { UnifiedTabContentProps } from "../types";

const ProjectLinearWorkItemsTabRenderer: React.FC<UnifiedTabContentProps> =
  memo(({ tab, isActive }) => {
    const { t } = useTranslation("projects");
    const {
      repoPath,
      onCreateProject,
      onCreateWorkItem,
      onUpdateTabData,
      onEmbeddedWorkItemDetailStateChange,
    } = useProjectHostContext();

    const linearSurface = normalizeProjectLinearSurfaceView(
      tab.data.linearSurface ?? PROJECT_LINEAR_SURFACE_VIEW.WORK_ITEMS
    );

    const breadcrumbSegments = useMemo(
      () => getProjectManagerBreadcrumbSegments(tab, t),
      [tab, t]
    );

    const handleLinearSurfaceChange = useCallback(
      (nextSurface: ProjectLinearSurfaceView) => {
        if (nextSurface === linearSurface) return;
        onUpdateTabData(tab.id, { linearSurface: nextSurface });
      },
      [linearSurface, onUpdateTabData, tab.id]
    );

    const linearSurfaceControls = useMemo(
      () => (
        <ProjectLinearSurfacePillSwitch
          linearSurface={linearSurface}
          onLinearSurfaceChange={handleLinearSurfaceChange}
        />
      ),
      [handleLinearSurfaceChange, linearSurface]
    );

    const handleOpenLinearProject = useCallback(
      (selection: {
        connectionId: string;
        projectId: string;
        projectName: string;
        teamId?: string;
        teamName?: string;
      }) => {
        onUpdateTabData(tab.id, selection);
      },
      [onUpdateTabData, tab.id]
    );

    const handleEmbeddedWorkItemDetailStateChange = useCallback(
      (
        tabId: string,
        state: Parameters<typeof onEmbeddedWorkItemDetailStateChange>[1]
      ) => {
        onEmbeddedWorkItemDetailStateChange(
          tabId,
          state,
          tab.data.projectName as string
        );
      },
      [onEmbeddedWorkItemDetailStateChange, tab.data.projectName]
    );

    return (
      <LinearProjectsPage
        surface={linearSurface}
        connectionId={tab.data.connectionId as string | undefined}
        projectId={tab.data.projectId as string | undefined}
        projectName={tab.data.projectName as string | undefined}
        teamId={tab.data.teamId as string | undefined}
        teamName={tab.data.teamName as string | undefined}
        breadcrumbSegments={breadcrumbSegments}
        linearSurfaceControls={linearSurfaceControls}
        workStationTabId={tab.id}
        repoPath={repoPath}
        onCreateProject={onCreateProject}
        onCreateWorkItem={onCreateWorkItem}
        onOpenLinearProject={handleOpenLinearProject}
        isActive={isActive}
        onEmbeddedWorkItemDetailStateChange={
          handleEmbeddedWorkItemDetailStateChange
        }
      />
    );
  });

ProjectLinearWorkItemsTabRenderer.displayName =
  "ProjectLinearWorkItemsTabRenderer";

export default ProjectLinearWorkItemsTabRenderer;
