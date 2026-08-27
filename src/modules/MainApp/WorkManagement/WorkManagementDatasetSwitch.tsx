import Boxes from "@hugeicons/core-free-icons/BoxesIcon";
import CircleDot from "@hugeicons/core-free-icons/CircleDotIcon";
import GitPullRequest from "@hugeicons/core-free-icons/GitPullRequestIcon";
import ListTodo from "@hugeicons/core-free-icons/ListTodoIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Select, { type SelectOption } from "@src/components/Select";

import {
  WORK_MANAGEMENT_DATASET,
  type WorkManagementDataset,
} from "./workManagementDataset";

interface WorkManagementDatasetSwitchProps {
  activeDataset: WorkManagementDataset;
  onChange: (dataset: WorkManagementDataset) => void;
}

export function WorkManagementDatasetSwitch({
  activeDataset,
  onChange,
}: WorkManagementDatasetSwitchProps): React.ReactNode {
  const { t } = useTranslation(["projects", "sessions"]);
  const projectsLabel = t("projects:workspace.projects");
  const workItemsLabel = t("projects:workspace.workItems");
  const issuesLabel = t("sessions:kanban.sidebar.githubIssues");
  const reviewsLabel = t("sessions:kanban.sidebar.githubPrs");
  const options = useMemo<SelectOption[]>(
    () => [
      {
        value: WORK_MANAGEMENT_DATASET.PROJECTS,
        label: projectsLabel,
        triggerLabel: projectsLabel,
        icon: (
          <HugeiconsIcon
            icon={Boxes}
            data-icon="boxes"
            size={14}
            strokeWidth={1.9}
            aria-hidden="true"
          />
        ),
        dataTestId: "work-dataset-projects",
      },
      {
        value: WORK_MANAGEMENT_DATASET.WORK_ITEMS,
        label: workItemsLabel,
        triggerLabel: workItemsLabel,
        icon: (
          <HugeiconsIcon
            icon={ListTodo}
            data-icon="list-todo"
            size={14}
            strokeWidth={1.9}
            aria-hidden="true"
          />
        ),
        dataTestId: "work-dataset-work-items",
      },
      {
        value: WORK_MANAGEMENT_DATASET.GITHUB_ISSUES,
        label: issuesLabel,
        triggerLabel: issuesLabel,
        icon: (
          <HugeiconsIcon
            icon={CircleDot}
            data-icon="circle-dot"
            size={14}
            strokeWidth={1.9}
            aria-hidden="true"
          />
        ),
        dataTestId: "work-dataset-github-issues",
      },
      {
        value: WORK_MANAGEMENT_DATASET.REVIEWS,
        label: reviewsLabel,
        triggerLabel: reviewsLabel,
        icon: (
          <HugeiconsIcon
            icon={GitPullRequest}
            data-icon="git-pull-request"
            size={14}
            strokeWidth={1.9}
            aria-hidden="true"
          />
        ),
        dataTestId: "work-dataset-reviews",
      },
    ],
    [issuesLabel, projectsLabel, reviewsLabel, workItemsLabel]
  );

  return (
    <Select
      value={activeDataset}
      options={options}
      onChange={(value) => {
        if (Array.isArray(value)) return;
        onChange(value as WorkManagementDataset);
      }}
      size="small"
      appearance="ghost"
      radius="lg"
      dropdownWidthMode="auto"
      dropdownMinWidth={180}
      dropdownAlign="left"
      className="!w-fit shrink-0"
      selectorClassName="h-7"
      style={{ width: "fit-content" }}
      dataTestId="work-dataset-select"
    />
  );
}
