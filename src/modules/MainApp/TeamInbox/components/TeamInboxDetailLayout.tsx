import type { LucideIcon } from "lucide-react";
import { Check, Mail } from "lucide-react";
import React from "react";

import Button from "@src/components/Button";
import { WorkstationToolbarTooltip } from "@src/modules/WorkStation/shared/WorkstationToolbarTooltip";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  InfoCard,
  PanelFooter,
  PanelHeader,
} from "@src/modules/shared/layouts/blocks";
import type { InfoCardRow } from "@src/modules/shared/layouts/blocks";

export interface TeamInboxDetailLayoutProps {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  metadata?: InfoCardRow[];
  /**
   * `scroll` owns a padded detail column. `fill` lets a nested Work Item own
   * its scrolling and responsive rail.
   */
  contentLayout?: "scroll" | "fill";
  unread: boolean;
  markReadLabel: string;
  markUnreadLabel?: string;
  openLabel: string;
  openIcon: React.ReactNode;
  onMarkRead?: () => void;
  onMarkUnread?: () => void;
  onOpen?: () => void;
  openPlacement?: "header" | "footer";
  children?: React.ReactNode;
}

const TeamInboxDetailLayout: React.FC<TeamInboxDetailLayoutProps> = ({
  title,
  subtitle,
  icon,
  metadata,
  contentLayout = "scroll",
  unread,
  markReadLabel,
  markUnreadLabel,
  openLabel,
  openIcon,
  onMarkRead,
  onMarkUnread,
  onOpen,
  openPlacement = "footer",
  children,
}) => {
  const readAction = unread ? (
    onMarkRead ? (
      <WorkstationToolbarTooltip label={markReadLabel} position="bottom-end">
        <Button
          htmlType="button"
          variant="tertiary"
          size="small"
          iconOnly
          icon={<Check size={14} strokeWidth={2} aria-hidden />}
          aria-label={markReadLabel}
          onClick={onMarkRead}
        />
      </WorkstationToolbarTooltip>
    ) : null
  ) : onMarkUnread && markUnreadLabel ? (
    <WorkstationToolbarTooltip label={markUnreadLabel} position="bottom-end">
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        icon={<Mail size={14} strokeWidth={2} aria-hidden />}
        aria-label={markUnreadLabel}
        onClick={onMarkUnread}
      />
    </WorkstationToolbarTooltip>
  ) : null;
  const headerOpenAction =
    onOpen && openPlacement === "header" ? (
      <WorkstationToolbarTooltip label={openLabel} position="bottom-end">
        <Button
          htmlType="button"
          variant="tertiary"
          size="small"
          iconOnly
          icon={openIcon}
          aria-label={openLabel}
          onClick={onOpen}
          data-testid="team-inbox-open-source"
        />
      </WorkstationToolbarTooltip>
    ) : null;

  return (
    <DetailPanelContainer>
      <PanelHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        borderBottom
        className="!pr-2"
        actions={
          readAction || headerOpenAction ? (
            <div
              className="flex items-center gap-px"
              data-testid="team-inbox-detail-actions"
            >
              {readAction}
              {headerOpenAction}
            </div>
          ) : undefined
        }
      />

      {contentLayout === "fill" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden @container">
          {children}
        </div>
      ) : (
        <div className={DETAIL_PANEL_TOKENS.scrollContent}>
          <div className={DETAIL_PANEL_TOKENS.contentWidthWithPadding}>
            {children ? (
              <div className={DETAIL_PANEL_TOKENS.sectionGap}>{children}</div>
            ) : null}
            {metadata && metadata.length > 0 ? (
              <InfoCard rows={metadata} />
            ) : null}
          </div>
        </div>
      )}

      {onOpen && openPlacement === "footer" ? (
        <PanelFooter
          primaryAction={{
            label: openLabel,
            icon: openIcon,
            onClick: onOpen,
          }}
        />
      ) : null}
    </DetailPanelContainer>
  );
};

/*
 * Keep the detail shell shared across mention and assigned-item surfaces.
 * Assigned Work Items opt into header placement so the thread owns the full
 * vertical canvas; other sources retain the established footer action.
 */

export default TeamInboxDetailLayout;
