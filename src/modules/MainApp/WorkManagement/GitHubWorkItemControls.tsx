import {
  Funnel,
  GitPullRequest,
  Link2,
  MessageCircle,
  MoreHorizontal,
  UserRound,
} from "lucide-react";
import React, { useCallback, useState } from "react";

import type { GitHubIssueUser } from "@src/api/tauri/github";
import Avatar from "@src/components/Avatar";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { PropertyDropdownField } from "@src/components/PropertyField/PropertyDropdownField";
import { Option } from "@src/components/PropertyField/PropertyFieldEditable";
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

export function toggleIssueAssigneeLogins(
  assignees: GitHubIssueUser[],
  login: string
): string[] {
  const normalizedLogin = login.toLowerCase();
  const selected = assignees.some(
    (assignee) => assignee.login.toLowerCase() === normalizedLogin
  );
  return selected
    ? assignees
        .filter((assignee) => assignee.login.toLowerCase() !== normalizedLogin)
        .map((assignee) => assignee.login)
    : [...assignees.map((assignee) => assignee.login), login];
}

export function ManagedIssueAssigneeCell({
  issue,
  assignableUsers,
  canManage,
  loading,
  loadError,
  updating,
  noneLabel,
  loadingLabel,
  searchPlaceholder,
  readonlyReason,
  onOpen,
  onChange,
}: {
  issue: ManagedIssueItem;
  assignableUsers: GitHubIssueUser[];
  canManage: boolean;
  loading: boolean;
  loadError: string | null;
  updating: boolean;
  noneLabel: string;
  loadingLabel: string;
  searchPlaceholder: string;
  readonlyReason: string;
  onOpen: (issue: ManagedIssueItem) => void | Promise<void>;
  onChange: (
    issue: ManagedIssueItem,
    assignees: string[]
  ) => void | Promise<void>;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const assignees = issue.rawIssue.assignees;
  const names = assignees.map((assignee) => assignee.login).join(", ");
  const triggerIcon = assignees[0] ? (
    <Avatar size={16} src={assignees[0].avatar_url}>
      {assignees[0].login.charAt(0).toUpperCase()}
    </Avatar>
  ) : (
    <UserRound size={14} strokeWidth={1.8} />
  );
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void onOpen(issue);
  };
  return (
    <div title={canManage ? names || noneLabel : readonlyReason}>
      <PropertyDropdownField
        value={names || "__none__"}
        label={names || noneLabel}
        icon={triggerIcon}
        selected={assignees.length > 0}
        active={open}
        onActiveChange={handleOpenChange}
        readonly={!canManage || updating}
        searchable
        searchPlaceholder={searchPlaceholder}
        maxWidthClassName="max-w-40"
        triggerVariant="pill"
        fieldVariant="pill"
        compactPill
        placement="portal"
        borderless
        dataTestId={`github-issue-assignee-${issue.id}`}
        renderOptions={(searchQuery, close) => {
          if (loading) {
            return (
              <div className="px-2.5 py-2 text-xs text-text-3">
                {loadingLabel}
              </div>
            );
          }
          if (loadError) {
            return (
              <div className="px-2.5 py-2 text-xs text-danger-6">
                {loadError}
              </div>
            );
          }
          const usersByLogin = new Map<string, GitHubIssueUser>();
          for (const user of [...assignees, ...assignableUsers]) {
            usersByLogin.set(user.login.toLowerCase(), user);
          }
          const query = searchQuery.trim().toLowerCase();
          const users = Array.from(usersByLogin.values()).filter(
            (user) => !query || user.login.toLowerCase().includes(query)
          );
          const selectedLogins = new Set(
            assignees.map((assignee) => assignee.login.toLowerCase())
          );
          return (
            <>
              <Option
                icon={<UserRound size={14} strokeWidth={1.8} />}
                label={noneLabel}
                isSelected={assignees.length === 0}
                onClick={() => {
                  void onChange(issue, []);
                  close();
                }}
                dataTestId={`github-issue-assignee-${issue.id}-option-none`}
              />
              {users.map((user) => {
                const selected = selectedLogins.has(user.login.toLowerCase());
                return (
                  <Option
                    key={user.login}
                    label={user.login}
                    isSelected={selected}
                    onClick={() => {
                      void onChange(
                        issue,
                        toggleIssueAssigneeLogins(assignees, user.login)
                      );
                      close();
                    }}
                    dataTestId={`github-issue-assignee-${issue.id}-option-${user.login}`}
                  >
                    <Avatar size={16} src={user.avatar_url}>
                      {user.login.charAt(0).toUpperCase()}
                    </Avatar>
                    <span className="flex-1 truncate">{user.login}</span>
                  </Option>
                );
              })}
            </>
          );
        }}
      />
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
