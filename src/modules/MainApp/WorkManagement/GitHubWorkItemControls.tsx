import {
  Funnel,
  GitPullRequest,
  Link2,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react";
import React, { useCallback, useState } from "react";

import Avatar from "@src/components/Avatar";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import type { SelectOption } from "@src/components/Select";

import {
  type ManagedIssueItem,
  type ManagedPrItem,
} from "./githubManagedItemModel";

export function IssuePersonalFilterDropdown({
  options,
  selectedFilters,
  filterLabel,
  onSelect,
}: {
  options: SelectOption[];
  selectedFilters: string[];
  filterLabel: string;
  onSelect: (values: (string | number)[]) => void;
}): React.ReactNode {
  const accessibleLabel =
    selectedFilters.length > 0
      ? `${filterLabel} (${selectedFilters.length})`
      : filterLabel;

  return (
    <Dropdown
      options={options}
      value={selectedFilters}
      mode="multiple"
      position="bottom-end"
      className={`${DROPDOWN_CLASSES.panelAnimated} ${DROPDOWN_WIDTHS.menuClass}`}
      onSelect={(value) => onSelect(Array.isArray(value) ? value : [value])}
    >
      <Button
        htmlType="button"
        variant="secondary"
        icon={<Funnel size={13} strokeWidth={1.8} />}
        iconOnly
        aria-label={accessibleLabel}
        title={accessibleLabel}
      />
    </Dropdown>
  );
}

export function ManagedIssueContextMeta({
  issue,
}: {
  issue: ManagedIssueItem;
}): React.ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] text-primary-6">
      {issue.linkedPullRequests > 0 ? (
        <span className="flex items-center gap-1">
          <GitPullRequest size={12} strokeWidth={1.8} />
          {issue.linkedPullRequests}
        </span>
      ) : null}
      {issue.comments > 0 ? (
        <span className="flex items-center gap-1">
          <MessageCircle size={12} strokeWidth={1.8} />
          {issue.comments}
        </span>
      ) : null}
    </div>
  );
}

export function ManagedIssueAssigneeCell({
  issue,
}: {
  issue: ManagedIssueItem;
}): React.ReactNode {
  const assignees = issue.rawIssue.assignees;
  if (assignees.length === 0) return <span className="text-text-3">—</span>;
  const names = assignees.map((assignee) => assignee.login).join(", ");
  return (
    <div className="flex max-w-40 items-center gap-1.5" title={names}>
      <div className="flex shrink-0 -space-x-1">
        {assignees.slice(0, 3).map((assignee) => (
          <Avatar key={assignee.login} size={20} src={assignee.avatar_url}>
            {assignee.login.charAt(0).toUpperCase()}
          </Avatar>
        ))}
      </div>
      <span className="truncate text-text-2">{names}</span>
    </div>
  );
}

export function ManagedIssueActionsCell({
  issue,
  addLabel,
  openInBrowserLabel,
  openInMyStationLabel,
  moreActionsLabel,
  onOpenIssueInBrowser,
  onOpenIssueInMyStation,
  onAddIssue,
}: {
  issue: ManagedIssueItem;
  addLabel: string;
  openInBrowserLabel: string;
  openInMyStationLabel: string;
  moreActionsLabel: string;
  onOpenIssueInBrowser: (issue: ManagedIssueItem) => void;
  onOpenIssueInMyStation: (issue: ManagedIssueItem) => void;
  onAddIssue: (issue: ManagedIssueItem) => void;
}): React.ReactNode {
  const [menuVisible, setMenuVisible] = useState(false);
  const closeMenu = useCallback(() => setMenuVisible(false), []);
  const droplist = (
    <div className={`${DROPDOWN_CLASSES.menuPanelBase} min-w-[180px]`}>
      <button
        type="button"
        className={DROPDOWN_CLASSES.menuActionItem}
        onClick={() => {
          onOpenIssueInBrowser(issue);
          closeMenu();
        }}
      >
        <span className="min-w-0 flex-1 truncate">{openInBrowserLabel}</span>
      </button>
      <button
        type="button"
        className={DROPDOWN_CLASSES.menuActionItem}
        onClick={() => {
          onOpenIssueInMyStation(issue);
          closeMenu();
        }}
      >
        <span className="min-w-0 flex-1 truncate">{openInMyStationLabel}</span>
      </button>
    </div>
  );

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        htmlType="button"
        variant="tertiary"
        appearance="ghost"
        size="mini"
        icon={<Link2 size={12} />}
        onClick={() => onAddIssue(issue)}
        aria-label={`${addLabel} #${issue.id}`}
      >
        {addLabel}
      </Button>
      <Dropdown
        droplist={droplist}
        trigger="click"
        position="bottom-end"
        popupVisible={menuVisible}
        onVisibleChange={setMenuVisible}
        getPopupContainer={() => document.body}
        avoidViewportOverflow
      >
        <Button
          htmlType="button"
          variant="tertiary"
          appearance="ghost"
          size="mini"
          icon={<MoreHorizontal size={13} />}
          iconOnly
          aria-label={moreActionsLabel}
          aria-expanded={menuVisible}
        />
      </Dropdown>
    </div>
  );
}

export function ManagedPrActionsCell({
  pr,
  addLabel,
  onAddPr,
}: {
  pr: ManagedPrItem;
  addLabel: string;
  onAddPr: (pr: ManagedPrItem) => void;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        htmlType="button"
        variant="tertiary"
        appearance="ghost"
        size="mini"
        icon={<Link2 size={12} />}
        onClick={() => onAddPr(pr)}
        aria-label={`${addLabel} #${pr.id}`}
      >
        {addLabel}
      </Button>
    </div>
  );
}
