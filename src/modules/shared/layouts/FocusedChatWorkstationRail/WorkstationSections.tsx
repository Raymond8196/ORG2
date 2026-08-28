/**
 * WorkstationSections — renders the rail's section list in both the wide
 * (trail) and compact (dropdown menu) presentations.
 */
import { useTranslation } from "react-i18next";

import { WORKSTATION_TRAIL_CONTENT } from "@src/config/workstation/tokens";
import {
  CloudIcon,
  FolderClosedIcon,
  FolderKanbanIcon,
  GitForkIcon,
  LaptopIcon,
  WorkflowCircle05Icon,
} from "@src/icons";

import { WorkspaceContextRow } from "./WorkspaceContextRow";
import { WorkstationItemRow } from "./WorkstationItemRow";
import type { WorkstationSectionsProps } from "./types";

export function WorkstationSections({
  compact = false,
  onRequestClose,
  sections,
}: WorkstationSectionsProps) {
  const { t } = useTranslation();
  return (
    <div
      className={compact ? "space-y-2" : WORKSTATION_TRAIL_CONTENT.sectionList}
      role={compact ? "menu" : undefined}
    >
      {sections.map((section) => (
        <section
          key={section.key}
          className={
            compact ? "space-y-0.5" : WORKSTATION_TRAIL_CONTENT.section
          }
        >
          {section.label && (
            <div className={WORKSTATION_TRAIL_CONTENT.sectionLabel}>
              {section.label}
            </div>
          )}
          {section.environment &&
            (section.environment.repoName ||
              section.environment.branchName ||
              section.environment.worktreeBranchName ||
              section.environment.workItem) && (
              <>
                {section.environment.environmentKind && (
                  <WorkspaceContextRow
                    compact={compact}
                    icon={
                      section.environment.environmentKind === "cloud"
                        ? CloudIcon
                        : LaptopIcon
                    }
                    label={t(
                      section.environment.environmentKind === "cloud"
                        ? "common:workstation.sessionEnvCloud"
                        : "common:workstation.sessionEnvLocal"
                    )}
                    chevron
                  />
                )}
                {section.environment.repoName && (
                  <WorkspaceContextRow
                    compact={compact}
                    icon={FolderClosedIcon}
                    label={section.environment.repoName}
                  />
                )}
                {section.environment.branchName && (
                  <WorkspaceContextRow
                    compact={compact}
                    icon={WorkflowCircle05Icon}
                    label={section.environment.branchName}
                    active={section.environment.branchAction?.active}
                    chevron={Boolean(section.environment.branchAction)}
                    onClick={section.environment.branchAction?.onClick}
                    onRequestClose={onRequestClose}
                    title={section.environment.branchAction?.label}
                    ariaLabel={section.environment.branchAction?.label}
                  />
                )}
                {section.environment.worktreeBranchName && (
                  <WorkspaceContextRow
                    compact={compact}
                    icon={GitForkIcon}
                    label={section.environment.worktreeBranchName}
                    title={section.environment.worktreePath}
                  />
                )}
                {section.environment.workItem && (
                  <WorkspaceContextRow
                    compact={compact}
                    icon={FolderKanbanIcon}
                    label={`${section.environment.workItem.label}${
                      section.environment.workItem.statusLabel
                        ? ` · ${section.environment.workItem.statusLabel}`
                        : ""
                    }`}
                    onClick={section.environment.workItem.onClick}
                    onRequestClose={onRequestClose}
                    testId="session-active-work-item-pill"
                  />
                )}
              </>
            )}
          {section.items.map((item) => (
            <WorkstationItemRow
              key={item.key}
              compact={compact}
              item={item}
              onRequestClose={onRequestClose}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
