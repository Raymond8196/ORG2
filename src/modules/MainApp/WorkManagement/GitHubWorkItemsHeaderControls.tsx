import type { ReactNode } from "react";

import { HeaderSectionSeparator } from "@src/components/HeaderSectionSeparator";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import { WorkManagementSearchInput } from "@src/modules/shared/components/WorkManagementSearchInput";

import { IssuePersonalFilterDropdown } from "./GitHubWorkItemControls";
import {
  GitHubWorkItemStateTabs,
  GitHubWorkItemToolbarActions,
} from "./GitHubWorkItemList";
import type { IssueRepoFilter, RepoFilterOption } from "./githubWorkItemsTypes";

interface GitHubWorkItemsHeaderControlsProps {
  repoOptions: RepoFilterOption[];
  selectedRepo: IssueRepoFilter;
  stateTabs: Array<{ key: string; label: string }>;
  activeState: string;
  searchQuery: string;
  searchPlaceholder: string;
  personalFilterOptions?: SelectOption[];
  selectedPersonalFilters?: string[];
  personalFilterLabel?: string;
  refreshLabel: string;
  refreshing: boolean;
  createAction?: {
    label: string;
    disabled: boolean;
    onClick: () => void;
  };
  onRepoSelect: (repo: IssueRepoFilter) => void;
  onStateChange: (state: string) => void;
  onSearchQueryChange: (query: string) => void;
  onPersonalFiltersSelect?: (values: (string | number)[]) => void;
  onRefresh: () => void;
}

/** Filters and actions published into the shared Work Management page header. */
export function GitHubWorkItemsHeaderControls({
  repoOptions,
  selectedRepo,
  stateTabs,
  activeState,
  searchQuery,
  searchPlaceholder,
  personalFilterOptions = [],
  selectedPersonalFilters = [],
  personalFilterLabel,
  refreshLabel,
  refreshing,
  createAction,
  onRepoSelect,
  onStateChange,
  onSearchQueryChange,
  onPersonalFiltersSelect,
  onRefresh,
}: GitHubWorkItemsHeaderControlsProps): ReactNode {
  const showPersonalFilters =
    personalFilterOptions.length > 0 &&
    personalFilterLabel !== undefined &&
    onPersonalFiltersSelect !== undefined;

  return (
    <div
      className="flex min-w-0 items-center gap-1 overflow-visible"
      data-testid="github-work-items-header-controls"
    >
      <Select
        value={selectedRepo}
        options={repoOptions.map((option) => ({
          value: option.key,
          label: option.label,
          triggerLabel: option.label,
        }))}
        onChange={(value) => {
          if (Array.isArray(value)) return;
          onRepoSelect(String(value));
        }}
        size="small"
        appearance="ghost"
        radius="lg"
        dropdownWidthMode="auto"
        dropdownMinWidth={190}
        dropdownAlign="right"
        className="w-auto"
        dataTestId="github-work-items-repository"
      />
      <GitHubWorkItemStateTabs
        tabs={stateTabs}
        activeTab={activeState}
        onChange={onStateChange}
      />
      {showPersonalFilters ? (
        <IssuePersonalFilterDropdown
          options={personalFilterOptions}
          selectedFilters={selectedPersonalFilters}
          filterLabel={personalFilterLabel}
          onSelect={onPersonalFiltersSelect}
        />
      ) : null}
      <WorkManagementSearchInput
        value={searchQuery}
        placeholder={searchPlaceholder}
        onChange={onSearchQueryChange}
        dataTestId="github-work-items-search"
      />
      <HeaderSectionSeparator className="mx-0.5" />
      <GitHubWorkItemToolbarActions
        refreshLabel={refreshLabel}
        refreshing={refreshing}
        createAction={createAction}
        onRefresh={onRefresh}
      />
    </div>
  );
}
