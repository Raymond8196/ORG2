import { CircleDot, GitPullRequest, ListTodo } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import TabPill, { type TabPillItem } from "@src/components/TabPill";

import {
  WORK_MANAGEMENT_DATASET,
  type WorkManagementDataset,
} from "./workManagementDataset";

interface WorkManagementDatasetSwitchProps {
  activeDataset: WorkManagementDataset;
  compact?: boolean;
  onChange: (dataset: WorkManagementDataset) => void;
}

function DatasetIcon({
  label,
  announceLabel,
  children,
}: {
  label: string;
  announceLabel: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center" title={label}>
      {children}
      {announceLabel ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export function WorkManagementDatasetSwitch({
  activeDataset,
  compact = false,
  onChange,
}: WorkManagementDatasetSwitchProps): React.ReactNode {
  const { t } = useTranslation(["projects", "sessions"]);
  const workItemsLabel = t("projects:workspace.workItems");
  const issuesLabel = t("sessions:kanban.sidebar.githubIssues");
  const reviewsLabel = t("sessions:kanban.sidebar.githubPrs");
  const tabs = useMemo<TabPillItem[]>(
    () => [
      {
        key: WORK_MANAGEMENT_DATASET.WORK_ITEMS,
        label: workItemsLabel,
        icon: (
          <DatasetIcon label={workItemsLabel} announceLabel={compact}>
            <ListTodo size={14} strokeWidth={1.9} aria-hidden="true" />
          </DatasetIcon>
        ),
        dataTestId: "work-dataset-work-items",
      },
      {
        key: WORK_MANAGEMENT_DATASET.GITHUB_ISSUES,
        label: issuesLabel,
        icon: (
          <DatasetIcon label={issuesLabel} announceLabel={compact}>
            <CircleDot size={14} strokeWidth={1.9} aria-hidden="true" />
          </DatasetIcon>
        ),
        dataTestId: "work-dataset-github-issues",
      },
      {
        key: WORK_MANAGEMENT_DATASET.REVIEWS,
        label: reviewsLabel,
        icon: (
          <DatasetIcon label={reviewsLabel} announceLabel={compact}>
            <GitPullRequest size={14} strokeWidth={1.9} aria-hidden="true" />
          </DatasetIcon>
        ),
        dataTestId: "work-dataset-reviews",
      },
    ],
    [compact, issuesLabel, reviewsLabel, workItemsLabel]
  );

  return (
    <TabPill
      tabs={tabs}
      activeTab={activeDataset}
      onChange={(key) => onChange(key as WorkManagementDataset)}
      variant="pill"
      color="fill"
      fillWidth={false}
      size="small"
      iconOnly={compact}
      buttonStyle
      height={28}
    />
  );
}
