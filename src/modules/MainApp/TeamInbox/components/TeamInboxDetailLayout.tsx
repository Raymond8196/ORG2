import React from "react";

import {
  HugeiconsIcon,
  type IconSvgElement,
  Mail01Icon,
  Tick01Icon,
} from "@src/icons";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  PanelHeader,
} from "@src/modules/shared/layouts/blocks";

import TeamInboxHeaderIconAction from "./TeamInboxHeaderIconAction";
import type { TeamInboxHeaderIconActionProps } from "./TeamInboxHeaderIconAction";

export interface TeamInboxDetailLayoutProps {
  title: string;
  subtitle: string;
  icon: IconSvgElement;
  /** Custom shared header content, such as the canonical GitHub issue strip. */
  headerContent?: React.ReactNode;
  unread: boolean;
  markReadLabel: string;
  markUnreadLabel?: string;
  openLabel: string;
  openIcon: React.ReactNode;
  headerAuxiliaryAction?: TeamInboxHeaderIconActionProps;
  onMarkRead?: () => void;
  onMarkUnread?: () => void;
  onOpen?: () => void;
  children?: React.ReactNode;
}

const TeamInboxDetailLayout: React.FC<TeamInboxDetailLayoutProps> = ({
  title,
  subtitle,
  icon,
  headerContent,
  unread,
  markReadLabel,
  markUnreadLabel,
  openLabel,
  openIcon,
  headerAuxiliaryAction,
  onMarkRead,
  onMarkUnread,
  onOpen,
  children,
}) => {
  const readAction = unread ? (
    onMarkRead ? (
      <TeamInboxHeaderIconAction
        label={markReadLabel}
        icon={
          <HugeiconsIcon
            icon={Tick01Icon}
            data-icon="check"
            size={14}
            strokeWidth={2}
            aria-hidden
          />
        }
        onClick={onMarkRead}
      />
    ) : null
  ) : onMarkUnread && markUnreadLabel ? (
    <TeamInboxHeaderIconAction
      label={markUnreadLabel}
      icon={
        <HugeiconsIcon
          icon={Mail01Icon}
          data-icon="mail"
          size={14}
          strokeWidth={2}
          aria-hidden
        />
      }
      onClick={onMarkUnread}
    />
  ) : null;
  const headerOpenAction = onOpen ? (
    <TeamInboxHeaderIconAction
      label={openLabel}
      icon={openIcon}
      onClick={onOpen}
      testId="team-inbox-open-source"
    />
  ) : null;
  const auxiliaryAction = headerAuxiliaryAction ? (
    <TeamInboxHeaderIconAction {...headerAuxiliaryAction} />
  ) : null;

  return (
    <DetailPanelContainer>
      <PanelHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        borderBottom
        className={DETAIL_PANEL_TOKENS.headerPadding}
        actions={
          readAction || auxiliaryAction || headerOpenAction ? (
            <div
              className="flex items-center gap-px"
              data-testid="team-inbox-detail-actions"
            >
              {readAction}
              {auxiliaryAction}
              {headerOpenAction}
            </div>
          ) : undefined
        }
      >
        {headerContent}
      </PanelHeader>

      <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </DetailPanelContainer>
  );
};

/*
 * Keep the detail shell shared across mention and assigned-item surfaces.
 * The shared shell keeps navigation actions in the header so every Inbox
 * source can give its detail content the full vertical canvas.
 */

export default TeamInboxDetailLayout;
