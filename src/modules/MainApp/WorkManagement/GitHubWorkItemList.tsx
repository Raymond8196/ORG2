import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";

import Button from "@src/components/Button";

export function GitHubWorkItemToolbarActions({
  openHref,
  openLabel,
  refreshLabel,
  refreshing,
  createAction,
  onRefresh,
}: {
  openHref: string | null;
  openLabel: string;
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
        variant="secondary"
        appearance="outline"
        size="small"
        icon={<ExternalLink size={13} />}
        iconOnly
        className="h-7 w-7"
        aria-label={openLabel}
        disabled={!openHref}
        href={openHref ?? undefined}
        target="_blank"
        rel="noreferrer"
      />
      {createAction ? (
        <Button
          htmlType="button"
          variant="secondary"
          appearance="outline"
          size="small"
          icon={<Plus size={13} />}
          iconOnly
          className="h-7 w-7"
          aria-label={createAction.label}
          onClick={createAction.onClick}
          disabled={createAction.disabled}
        />
      ) : null}
      <Button
        htmlType="button"
        variant="secondary"
        appearance="outline"
        size="small"
        icon={<RefreshCw size={13} />}
        iconOnly
        loading={refreshing}
        loadingSpinIcon
        className="h-7 w-7"
        aria-label={refreshLabel}
        onClick={onRefresh}
      />
    </>
  );
}

export interface GitHubWorkItemSummaryTab {
  key: string;
  label: string;
  count: number | null;
  icon: ReactNode;
  active?: boolean;
  onSelect?: () => void;
}

export function GitHubWorkItemSummary({
  tabs,
  actions,
}: {
  tabs: GitHubWorkItemSummaryTab[];
  actions?: ReactNode;
}): ReactNode {
  return (
    <div className="flex h-10 items-center gap-4 border-b border-border-2 bg-bg-1 px-3">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`flex items-center gap-1.5 text-[12px] font-medium ${
            tab.active === false
              ? "text-text-3 hover:text-text-1"
              : "text-text-1"
          }`}
          onClick={tab.onSelect}
          aria-pressed={tab.onSelect ? tab.active : undefined}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== null ? (
            <span className="rounded-full bg-fill-2 px-1.5 py-0.5 text-[10px] text-text-2">
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
      {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
    </div>
  );
}

export function GitHubWorkItemListFrame({
  summary,
  height,
  children,
}: {
  summary?: ReactNode;
  height: number;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="bg-bg-0 overflow-hidden rounded-lg border border-border-2">
      {summary}
      <div className="relative w-full" style={{ height }}>
        {children}
      </div>
    </div>
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
    <div className="group flex min-h-[72px] w-full items-start gap-2.5 px-3 py-2.5 transition-colors focus-within:bg-fill-1/60 hover:bg-fill-1/60">
      <span className="mt-1 shrink-0">{icon}</span>
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
  return (
    <div className="flex h-12 shrink-0 items-center justify-center gap-3 border-t border-border-2 px-3">
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        icon={<ChevronLeft size={14} strokeWidth={1.75} />}
        disabled={!canGoPrevious}
        onClick={onPrevious}
        aria-label={previousLabel}
        title={previousLabel}
      />
      <span className="min-w-20 text-center text-[11px] text-text-3">
        {totalLabel}
      </span>
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        icon={<ChevronRight size={14} strokeWidth={1.75} />}
        loading={loadingNext}
        disabled={!canGoNext || loadingNext}
        onClick={onNext}
        aria-label={nextLabel}
        title={nextLabel}
      />
    </div>
  );
}
