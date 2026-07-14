/**
 * Renderer wrapper for `project-dashboard` tabs.
 *
 * Renders the Projects surface through the unified dispatcher, pulling its
 * action callbacks from the hoisted Project host context
 * (`useProjectHostContext`) and deriving breadcrumb / org scope from tab data
 * — mirroring how `ProjectManagerContentRouter` mounts `ProjectsPage`.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import {
  getProjectManagerBreadcrumbSegments,
  getTabDataString,
} from "@src/modules/ProjectManager/ProjectManagerLayout/components/projectManagerRouterUtils";
import { useProjectHostContext } from "@src/modules/ProjectManager/ProjectManagerLayout/context/projectHostContext";
import ProjectsPage from "@src/modules/ProjectManager/Projects";
import { STORY_ORG_SCOPE } from "@src/store/workstation/tabs";

import type { UnifiedTabContentProps } from "../types";

const ProjectDashboardTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const { t } = useTranslation("projects");
    const { onSelectProject, onCreateProject, onOpenLinearProjects } =
      useProjectHostContext();

    const breadcrumbSegments = getProjectManagerBreadcrumbSegments(tab, t);
    const orgScope =
      (tab.data.orgScope as string | undefined) ?? STORY_ORG_SCOPE.ALL;
    const allowExternalSources = orgScope === STORY_ORG_SCOPE.ALL;
    const scopedOrgId =
      orgScope !== STORY_ORG_SCOPE.ALL
        ? getTabDataString(tab, "orgId")
        : undefined;

    return (
      <ProjectsPage
        breadcrumbSegments={breadcrumbSegments}
        orgId={scopedOrgId}
        onOpenProject={onSelectProject}
        onAddProject={onCreateProject}
        onOpenLinearProject={onOpenLinearProjects}
        allowExternalSources={allowExternalSources}
        publishToWorkstationHeader
        workStationTabId={tab.id}
      />
    );
  }
);

ProjectDashboardTabRenderer.displayName = "ProjectDashboardTabRenderer";

export default ProjectDashboardTabRenderer;
