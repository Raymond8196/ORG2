import type { TFunction } from "i18next";
import { ChevronRight, Download, Gauge, Import, KeyRound } from "lucide-react";
import React, { useCallback, useState } from "react";

import { PILL_CONTROL_IDLE_SURFACE_CLASS } from "@src/components/CompoundPill/config";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import Select, { type SelectOption } from "@src/components/Select";
import TabPill from "@src/components/TabPill";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import ImportSharedSessionDialog from "@src/features/Org2Cloud/ImportSharedSessionDialog";
import { CreatorContentLayout } from "@src/modules/shared/layouts/blocks";
import { useAvailableAppUpdate } from "@src/scaffold/AppUpdater";
import {
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelCreateTarget,
} from "@src/store/ui/chatPanelAtom";

type StartPageActionTone = "primary" | "neutral" | "success" | "warning";
type StartPageActionPresentation = "card" | "pill";
type StartPageView = "session" | "work-item" | "more";

interface ChatPanelStartPageAction {
  id: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  tone: StartPageActionTone;
}

const START_PAGE_ACTION_TONE_CLASS: Record<StartPageActionTone, string> = {
  primary:
    "border-primary-6/20 bg-primary-6/5 hover:border-primary-6/30 hover:bg-primary-6/10",
  neutral: `border-border-2 hover:border-border-3 ${PILL_CONTROL_IDLE_SURFACE_CLASS}`,
  success:
    "border-success-6/20 bg-success-6/5 hover:border-success-6/30 hover:bg-success-6/10",
  warning:
    "border-warning-6/20 bg-warning-6/5 hover:border-warning-6/30 hover:bg-warning-6/10",
};

const START_PAGE_ACTION_CARD_TONE_CLASS: Record<StartPageActionTone, string> = {
  primary:
    "border-primary-6/20 hover:border-primary-6/30 hover:bg-surface-hover",
  neutral: "border-border-2 hover:border-border-3 hover:bg-surface-hover",
  success:
    "border-success-6/20 hover:border-success-6/30 hover:bg-surface-hover",
  warning:
    "border-warning-6/20 hover:border-warning-6/30 hover:bg-surface-hover",
};

const START_PAGE_ACTION_ICON_TONE_CLASS: Record<StartPageActionTone, string> = {
  primary: "text-primary-6",
  neutral: "text-text-2",
  success: "text-success-6",
  warning: "text-warning-6",
};

interface ChatPanelStartPageProps {
  className?: string;
  createTarget: ChatPanelCreateTarget;
  createTargetOptions: SelectOption[];
  moreLauncher?: (
    suggestionPills: React.ReactNode,
    manualMiddleContent: React.ReactNode,
    creatorModeControl?: React.ReactNode
  ) => React.ReactNode;
  onAddApiKey: () => void;
  onCreateTarget: (target: ChatPanelCreateTarget) => void;
  onInstallLatestUpdate: () => void;
  onShowRuntime: () => void;
  onProjectAgentModeChange: (enabled: boolean) => void;
  onWorkItemAgentModeChange: (enabled: boolean) => void;
  projectAgentMode: boolean;
  sessionLauncher?: (heroFooterSlot: React.ReactNode) => React.ReactNode;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
  workItemAgentMode: boolean;
  workItemLauncher?: (
    suggestionPills: React.ReactNode,
    manualMiddleContent: React.ReactNode,
    creatorModeControl: React.ReactNode
  ) => React.ReactNode;
}

interface StartPageCreatorModeToggleProps {
  agentMode: boolean;
  dataTestId: string;
  onChange: (enabled: boolean) => void;
  t: TFunction<["sessions", "common", "projects", "navigation"]>;
}

function StartPageCreatorModeToggle({
  agentMode,
  dataTestId,
  onChange,
  t,
}: StartPageCreatorModeToggleProps): React.ReactNode {
  return (
    <SegmentedTextPill
      ariaLabel={`${t("common:terminology.agent")} / ${t(
        "common:tooltips.manual"
      )}`}
      dataTestId={dataTestId}
      value={agentMode ? "agent" : "manual"}
      options={[
        { value: "agent", label: t("common:terminology.agent") },
        { value: "manual", label: t("common:tooltips.manual") },
      ]}
      onChange={(value) => onChange(value === "agent")}
    />
  );
}

function StartPageActionCard({
  action,
  presentation = "pill",
}: {
  action: ChatPanelStartPageAction;
  presentation?: StartPageActionPresentation;
}): React.ReactNode {
  if (presentation === "card") {
    return (
      <button
        type="button"
        className={`group flex min-h-[68px] w-full flex-col items-start justify-between rounded-lg border bg-transparent px-2.5 py-2 text-left shadow-sm transition-colors focus-visible:border-primary-6 focus-visible:outline-none ${START_PAGE_ACTION_CARD_TONE_CLASS[action.tone]}`}
        onClick={action.onClick}
        data-testid={`chat-panel-start-page-${action.id}`}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center ${START_PAGE_ACTION_ICON_TONE_CLASS[action.tone]}`}
        >
          {action.icon}
        </span>
        <span className="block text-[12px] font-medium leading-4 text-text-1">
          {action.title}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`group flex w-full items-center gap-2 rounded-full border px-2 py-1.5 text-left transition-colors focus-visible:border-primary-6 focus-visible:outline-none ${START_PAGE_ACTION_TONE_CLASS[action.tone]}`}
      onClick={action.onClick}
      data-testid={`chat-panel-start-page-${action.id}`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-2 text-text-2 transition-colors ${
          action.tone === "warning" ? "group-hover:bg-fill-3" : ""
        }`}
      >
        {action.icon}
      </span>
      <span className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
        {action.title}
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.8}
        className="shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

function StartPageActionGrid({
  actions,
  className = "",
  presentation = "pill",
}: {
  actions: ChatPanelStartPageAction[];
  className?: string;
  presentation?: StartPageActionPresentation;
}): React.ReactNode {
  const cardWidthClass =
    actions.length >= 4
      ? "max-w-[600px]"
      : actions.length === 3
        ? "max-w-[480px]"
        : "max-w-[320px]";
  const cardColumnClass =
    actions.length >= 4
      ? "@[560px]/startactions:grid-cols-4"
      : actions.length === 3
        ? "@[440px]/startactions:grid-cols-3"
        : "";

  return (
    <div
      className={`@container/startactions ${
        presentation === "card"
          ? `hidden @[640px]/focusedchat:block ${cardWidthClass}`
          : ""
      } ${className}`}
    >
      <div
        className={
          presentation === "card"
            ? `grid grid-cols-1 gap-2 @[300px]/startactions:grid-cols-2 ${cardColumnClass}`
            : "grid grid-cols-1 gap-3 @[420px]/startactions:grid-cols-2 @[800px]/startactions:grid-cols-3"
        }
      >
        {actions.map((action) => (
          <StartPageActionCard
            key={action.id}
            action={action}
            presentation={presentation}
          />
        ))}
      </div>
    </div>
  );
}

export function ChatPanelStartPage({
  className,
  createTarget,
  createTargetOptions,
  moreLauncher,
  onAddApiKey,
  onCreateTarget,
  onInstallLatestUpdate,
  onShowRuntime,
  onProjectAgentModeChange,
  onWorkItemAgentModeChange,
  projectAgentMode,
  sessionLauncher,
  t,
  workItemAgentMode,
  workItemLauncher,
}: ChatPanelStartPageProps): React.ReactNode {
  const [isImportSessionDialogOpen, setIsImportSessionDialogOpen] =
    useState(false);
  const availableUpdate = useAvailableAppUpdate();
  const importSessionAction: ChatPanelStartPageAction = {
    id: "import-session",
    title: t("navigation:cloud.share.importEntry"),
    icon: <Import size={16} strokeWidth={1.8} />,
    onClick: () => setIsImportSessionDialogOpen(true),
    tone: "neutral",
  };
  const addApiKeyAction: ChatPanelStartPageAction = {
    id: "add-api-key",
    title: t("chat.startPage.addApiKey.title"),
    icon: <KeyRound size={16} strokeWidth={1.8} />,
    onClick: onAddApiKey,
    tone: "neutral",
  };
  const showRuntimeAction: ChatPanelStartPageAction = {
    id: "show-runtime",
    title: t("chat.startPage.showRuntime.title"),
    icon: <Gauge size={16} strokeWidth={1.8} />,
    onClick: onShowRuntime,
    tone: "neutral",
  };
  const utilityActions: ChatPanelStartPageAction[] = availableUpdate?.available
    ? [
        {
          id: "install-latest-update",
          title: t("chat.startPage.installLatestUpdate.title"),
          icon: <Download size={16} strokeWidth={1.8} />,
          onClick: onInstallLatestUpdate,
          tone: "warning",
        },
        importSessionAction,
        addApiKeyAction,
        showRuntimeAction,
      ]
    : [importSessionAction, addApiKeyAction, showRuntimeAction];
  const selectedMoreTarget = createTargetOptions.some(
    (option) => option.value === createTarget
  )
    ? createTarget
    : createTargetOptions[0]?.value;
  const activeView: StartPageView =
    createTarget === CHAT_PANEL_CREATE_TARGET.AGENT_SESSION
      ? "session"
      : createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM
        ? "work-item"
        : "more";
  const suggestionPills = (
    <StartPageActionGrid
      actions={utilityActions}
      className="mx-auto w-full"
      presentation="card"
    />
  );
  const manualMiddleContent = (
    <div
      className="flex w-full flex-col items-center justify-center gap-4"
      data-testid="chat-panel-start-page-manual-middle-content"
    >
      <h1 className="text-center text-[18px] font-normal leading-relaxed tracking-tight text-text-1 sm:text-[20px]">
        {t("creator.manualLaunchpadQuestion")}
      </h1>
      {suggestionPills}
    </div>
  );
  const workItemModeControl = (
    <StartPageCreatorModeToggle
      agentMode={workItemAgentMode}
      dataTestId="chat-panel-start-page-work-item-mode-toggle"
      onChange={onWorkItemAgentModeChange}
      t={t}
    />
  );
  const projectModeControl = (
    <StartPageCreatorModeToggle
      agentMode={projectAgentMode}
      dataTestId="chat-panel-start-page-project-mode-toggle"
      onChange={onProjectAgentModeChange}
      t={t}
    />
  );
  const sessionLauncherContent = sessionLauncher?.(suggestionPills);
  const workItemLauncherContent = workItemLauncher?.(
    suggestionPills,
    manualMiddleContent,
    workItemModeControl
  );
  const moreLauncherContent = moreLauncher?.(
    suggestionPills,
    manualMiddleContent,
    createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT
      ? projectModeControl
      : undefined
  );
  const showUtilityActionsFooter =
    activeView === "more" && createTarget !== CHAT_PANEL_CREATE_TARGET.PROJECT;
  const handleViewChange = useCallback(
    (key: string) => {
      if (key === "session") {
        onCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        return;
      }
      if (key === "work-item") {
        onCreateTarget(CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
        return;
      }
      if (
        key === "more" &&
        !createTargetOptions.some((option) => option.value === createTarget)
      ) {
        const fallbackTarget = createTargetOptions[0]?.value;
        if (typeof fallbackTarget === "string") {
          onCreateTarget(fallbackTarget as ChatPanelCreateTarget);
        }
      }
    },
    [createTarget, createTargetOptions, onCreateTarget]
  );

  return (
    <div
      className={`flex w-full flex-col overflow-hidden ${className ?? ""}`}
      data-testid="chat-panel-start-page"
    >
      <div
        className="shrink-0 bg-chat-pane"
        data-testid="chat-panel-start-page-tabs"
      >
        <div
          className={`${DETAIL_PANEL_TOKENS.headerWidth} flex h-14 items-center justify-center gap-3 px-4 pt-1`}
        >
          <TabPill
            activeTab={activeView}
            tabs={[
              {
                key: "session",
                label: t("chat.startPage.tabs.session"),
                dataTestId: "chat-panel-start-page-tab-session",
              },
              {
                key: "work-item",
                label: t("chat.startPage.tabs.workItem"),
                dataTestId: "chat-panel-start-page-tab-work-item",
              },
              {
                key: "more",
                label: t("chat.startPage.tabs.more"),
                dataTestId: "chat-panel-start-page-tab-more",
              },
            ]}
            onChange={handleViewChange}
            variant="simple"
            size="large"
            fillWidth={false}
            className="h-10"
          />
          {activeView === "more" ? (
            <div
              className="flex -translate-y-1 items-center gap-2"
              data-testid="chat-panel-start-page-trailing-control"
            >
              <span
                className="h-5 w-px shrink-0 bg-border-2"
                role="separator"
                aria-hidden
                data-testid="chat-panel-start-page-trailing-separator"
              />
              <Select
                value={selectedMoreTarget}
                options={createTargetOptions}
                onChange={(value) => {
                  if (!Array.isArray(value)) {
                    onCreateTarget(value as ChatPanelCreateTarget);
                  }
                }}
                size="large"
                variant="ghost"
                radius="pill"
                dropdownMinWidth={168}
                dropdownWidthMode="auto"
                className="w-auto"
                selectorClassName="max-w-[240px] !gap-2 !px-1 !text-[16px] !leading-6 [&_.select-suffix]:!ml-0"
                dataTestId="chat-panel-start-page-create-target-select"
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeView === "work-item" ? (
          <div
            className="flex h-full min-h-0 w-full"
            data-testid="chat-panel-start-page-work-item-launcher"
          >
            {workItemLauncherContent}
          </div>
        ) : activeView === "more" ? (
          <div
            className="flex h-full min-h-0 w-full flex-col overflow-hidden"
            data-testid="chat-panel-start-page-more-launcher"
          >
            {moreLauncherContent}
          </div>
        ) : (
          <CreatorContentLayout
            placement="fill"
            contentDataTestId="chat-panel-start-page-session-content"
          >
            {sessionLauncherContent ? (
              <div
                className="h-full w-full"
                data-testid="chat-panel-start-page-session-launcher"
              >
                {sessionLauncherContent}
              </div>
            ) : null}
          </CreatorContentLayout>
        )}
      </div>
      {showUtilityActionsFooter && (
        <div
          className={`shrink-0 px-4 pb-5 pt-2 ${DETAIL_PANEL_TOKENS.headerWidth}`}
          data-testid="chat-panel-start-page-utility-actions"
        >
          <StartPageActionGrid actions={utilityActions} className="w-full" />
        </div>
      )}
      {isImportSessionDialogOpen && (
        <ImportSharedSessionDialog
          visible
          onClose={() => setIsImportSessionDialogOpen(false)}
        />
      )}
    </div>
  );
}
