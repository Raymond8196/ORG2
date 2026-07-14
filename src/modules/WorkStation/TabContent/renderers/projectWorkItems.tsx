/**
 * Renderer wrapper for `project-work-items` tabs.
 *
 * Renders the all-work-items index (`ProjectWorkItemsTabContent`) through the
 * unified dispatcher, pulling action callbacks from the hoisted Project host
 * context and deriving breadcrumb / org scope from tab data — mirroring
 * `ProjectManagerContentRouter`.
 */
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { ProjectWorkItemsTabContent } from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectWorkItemsTabContent";
import {
  getProjectManagerBreadcrumbSegments,
  getTabDataString,
} from "@src/modules/ProjectManager/ProjectManagerLayout/components/projectManagerRouterUtils";
import { useProjectHostContext } from "@src/modules/ProjectManager/ProjectManagerLayout/context/projectHostContext";
import { STORY_ORG_SCOPE } from "@src/store/workstation/tabs";

import type { UnifiedTabContentProps } from "../types";

const ProjectWorkItemsTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => {
    const { t } = useTranslation("projects");
    const {
      onExpandWorkItemToTab,
      onOpenLinearProjects,
      onCreateProject,
      onCreateWorkItem,
    } = useProjectHostContext();

    const breadcrumbSegments = getProjectManagerBreadcrumbSegments(tab, t);
    const orgScope =
      (tab.data.orgScope as string | undefined) ?? STORY_ORG_SCOPE.ALL;
    const allowExternalSources = orgScope === STORY_ORG_SCOPE.ALL;
    const scopedOrgId =
      orgScope !== STORY_ORG_SCOPE.ALL
        ? getTabDataString(tab, "orgId")
        : undefined;

    return (
      <ProjectWorkItemsTabContent
        breadcrumbSegments={breadcrumbSegments}
        orgId={scopedOrgId}
        onOpenWorkItem={onExpandWorkItemToTab}
        onOpenLinearProject={onOpenLinearProjects}
        allowExternalSources={allowExternalSources}
        onCreateProject={onCreateProject}
        onCreateWorkItem={() => onCreateWorkItem()}
        workStationTabId={tab.id}
      />
    );
  }
);

ProjectWorkItemsTabRenderer.displayName = "ProjectWorkItemsTabRenderer";

export default ProjectWorkItemsTabRenderer;
