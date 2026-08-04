import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Loader2,
  RefreshCw,
  SquarePen,
} from "lucide-react";
import type { ReactNode } from "react";

import Button from "@src/components/Button";
import { SearchInput } from "@src/components/SearchInput";
import { PAGE_ICON_BUTTON } from "@src/components/SettingsTable/SettingsTablePagination";
import TabPill, { type TabPillItem } from "@src/components/TabPill";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

export const GITHUB_WORK_ITEMS_SINGLE_ROW_MIN_WIDTH = 650;

export function shouldUseSingleRowGitHubWorkItemsHeader(
  containerWidth: number
): boolean {
  return containerWidth >= GITHUB_WORK_ITEMS_SINGLE_ROW_MIN_WIDTH;
}

export function GitHubWorkItemTableSurface({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div
      className="flex min-h-0 w-full flex-1 flex-col"
      data-testid="github-work-items-table-surface"
    >
      {children}
    </div>
  );
}

export function GitHubWorkItemSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <SearchInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      ariaLabel={placeholder}
      variant="panel"
      surface="transparent"
      hideChevron
      showClearButton
      inputBoxClassName="flex-1"
      className="min-w-0 flex-1"
    />
  );
}

export function GitHubWorkItemToolbarActions({
  refreshLabel,
  refreshing,
  createAction,
  onRefresh,
}: {
  refreshLabel: string;
  refreshing: boolean;
  createAction?: {
    label: string;
    disabled: boolean;
    onClick: () => void;
  };
  onRefresh: () => void;
}): ReactNode {
  return (
    <>
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        icon={<RefreshCw size={13} />}
        iconOnly
        loading={refreshing}
        loadingSpinIcon
        className="h-7 w-7"
        aria-label={refreshLabel}
        onClick={onRefresh}
      />
      {createAction ? (
        <Button
          htmlType="button"
          variant="tertiary"
          size="small"
          icon={<SquarePen size={14} strokeWidth={2} />}
          iconOnly
          className="h-7 w-7"
          aria-label={createAction.label}
          onClick={createAction.onClick}
          disabled={createAction.disabled}
        />
      ) : null}
    </>
  );
}

export interface GitHubWorkItemStateTab {
  key: string;
  label: string;
}

export function GitHubWorkItemStateTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: GitHubWorkItemStateTab[];
  activeTab: string;
  onChange: (key: string) => void;
}): ReactNode {
  const tabItems: TabPillItem[] = tabs.map((tab) => ({
    key: tab.key,
    label: tab.label,
    icon:
      tab.key === "open" ? (
        <span className="flex items-center text-success-6" title={tab.label}>
          <CircleDot size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">{tab.label}</span>
        </span>
      ) : (
        <span className="text-purple-6 flex items-center" title={tab.label}>
          <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">{tab.label}</span>
        </span>
      ),
    dataTestId: `github-work-items-state-${tab.key}`,
  }));

  return (
    <TabPill
      tabs={tabItems}
      activeTab={activeTab}
      onChange={onChange}
      variant="pill"
      color="fill"
      iconOnly
      fillWidth={false}
      size="small"
    />
  );
}

export function GitHubWorkItemListFrame({
  height,
  children,
}: {
  height?: number;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="bg-bg-0 overflow-hidden border-y border-border-2">
      <div
        className="w-full"
        style={height === undefined ? undefined : { height }}
      >
        {children}
      </div>
    </div>
  );
}

export function GitHubWorkItemSection({
  label,
  testId,
  children,
  defaultOpen = true,
}: {
  label: string;
  testId: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}): ReactNode {
  return (
    <section
      className="border-t border-border-2 first:border-t-0"
      data-testid={testId}
      aria-label={label}
    >
      <CollapsibleSection
        title={label}
        defaultOpen={defaultOpen}
        compact
        headerRowClassName="mb-0 h-auto"
        titleButtonClassName="w-full px-3 py-2 text-left text-[11px] font-medium text-text-3"
        titleClassName="min-w-0 flex-1 truncate"
        chevronSize={12}
        chevronStrokeWidth={2}
        titleButtonTestId={`${testId}-toggle`}
      >
        <div
          className="divide-y divide-border-2 border-t border-border-2"
          data-testid={`${testId}-content`}
        >
          {children}
        </div>
      </CollapsibleSection>
    </section>
  );
}

export function GitHubWorkItemRow({
  icon,
  content,
  trailing,
  actions,
}: {
  icon: ReactNode;
  content: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <div className="group flex min-h-[52px] w-full items-center gap-2.5 px-3 py-2 transition-colors focus-within:bg-fill-1/60 hover:bg-fill-1/60">
      <span className="shrink-0">{icon}</span>
      {content}
      {actions}
      {trailing}
    </div>
  );
}

export function GitHubWorkItemPagination({
  totalLabel,
  previousLabel,
  nextLabel,
  loadingNext,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: {
  totalLabel: ReactNode;
  previousLabel: string;
  nextLabel: string;
  loadingNext: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}): ReactNode {
  // Shares the session-table pagination footer look (PAGE_ICON_BUTTON prev/next
  // + text-xs label) while keeping the surface's load-more behavior.
  return (
    <div className="flex h-12 shrink-0 items-center justify-center gap-2 border-t border-border-2 px-3">
      <button
        type="button"
        className={PAGE_ICON_BUTTON}
        disabled={!canGoPrevious}
        onClick={onPrevious}
        aria-label={previousLabel}
        title={previousLabel}
      >
        <ChevronLeft size={14} />
      </button>
      <span className="min-w-20 text-center text-xs text-text-1">
        {totalLabel}
      </span>
      <button
        type="button"
        className={PAGE_ICON_BUTTON}
        disabled={!canGoNext || loadingNext}
        onClick={onNext}
        aria-label={nextLabel}
        title={nextLabel}
      >
        {loadingNext ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ChevronRight size={14} />
        )}
      </button>
    </div>
  );
}
