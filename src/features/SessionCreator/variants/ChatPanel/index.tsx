import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  Airplay,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Network,
  Play,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  type RemotePreflightResult,
  remotePreflight,
} from "@src/api/tauri/agent/session";
import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";
import type { CliAgentType } from "@src/api/types/keys";
import Button from "@src/components/Button";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import InlineAlert from "@src/components/InlineAlert";
import ModelIcon from "@src/components/ModelIcon";
import SelectorPill from "@src/components/SelectorPill";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { isRegionSanctioned } from "@src/config/providerRegions";
import type { ScrollNavState } from "@src/engines/ChatPanel/ChatHistory";
import CollapsedInlineRow from "@src/engines/ChatPanel/InputArea/components/CollapsedInlineRow";
import PinnedActionsBar from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar";
import { useBrowserAddToConversationAction } from "@src/engines/ChatPanel/hooks/useBrowserAddToConversationAction";
import type {
  ChatPanelCliTerminalLaunchOptions,
  ChatPanelRegionNotice,
} from "@src/engines/ChatPanel/types";
import { useSessionCreator } from "@src/engines/SessionCore/hooks/session/useSessionCreator";
import type {
  SessionLaunchSuccessInfo,
  SessionLaunchWorkItemContext,
} from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { buildRemoteTargetDisplay } from "@src/features/SessionCreator/remoteTargetDisplay";
import type { SessionCreatorLaunchMode } from "@src/features/SessionCreator/types";
import {
  SYSTEM_HOME_SOURCE_ID,
  getSystemHomeSourceLabel,
  isSystemPathSourceId,
} from "@src/features/SessionCreator/utils/systemPathSource";
import { useRegionCheck } from "@src/hooks/config";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { createLogger } from "@src/hooks/logger";
import { useAgentCompatibility } from "@src/hooks/models/useAgentCompatibility";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import { useAgentOrgs } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentOrgs";
import { useCliAgents } from "@src/modules/MainApp/Integrations/KeyVault/CliClients/hooks/useCliAgents";
import {
  type AgentSelection,
  DispatchCategoryPalette,
} from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette";
import { DispatchCategoryDropdown } from "@src/scaffold/GlobalSpotlight/palettes/DispatchCategoryPalette/DispatchCategoryDropdown";
import { PresenceMenuButton } from "@src/scaffold/NavigationSidebar/blocks/SidebarBottomBar";
import { TerminalService } from "@src/services/terminal";
import { gitDependencyInstalledAtom } from "@src/store/platform/gitDependencyAtom";
import { REPO_KIND } from "@src/store/repo/types";
import {
  CLI_LAUNCH_MODE,
  SESSION_TARGET_KIND,
  type WorktreeLaunchSource,
  agentIconIdAtom,
  agentNameAtom,
  cliAgentTypeAtom,
  cliAgentVisibilityOverridesAtom,
  cliLaunchModeAtom,
  dispatchCategoryAtom,
  isCliAgentEnabled,
  selectedAgentDefinitionIdAtom,
  selectedAgentOrgIdAtom,
  sessionCreatorStateAtom,
  sessionSourceAtom,
  sessionTargetKindAtom,
  worktreeLaunchSourceAtom,
} from "@src/store/session";
import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultTuiModeAtom } from "@src/store/session/creatorDefaultTuiModeAtom";
import { openCategoryPickerSignalAtom } from "@src/store/session/openCategoryPickerAtom";
import { runningLocationAtom } from "@src/store/session/runningLocationAtom";
import { selectedWorktreePathAtom } from "@src/store/session/selectedWorktreePathAtom";
import { tuiModeAtom } from "@src/store/session/tuiModeAtom";
import {
  type ChatImageAttachment,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";
import {
  chatPanelSelectedProjectAtom,
  chatPanelSelectedProjectOrgAtom,
  chatPanelSelectedWorkItemAtom,
  modelPickerStyleAtom,
} from "@src/store/ui/chatPanelAtom";
import { draftHasContentAtom } from "@src/store/ui/draftAtom";
import { getBigThreeRegionModelTypeForSession } from "@src/util/session/regionAlertModel";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

import {
  CliLaunchModeSwitch,
  EditorArea,
  SessionInfoLine,
} from "../../components";
import type { DropdownDirection } from "../../components/ControlButtons";
import ScreenPickerModal from "./ScreenPickerModal";
import SessionCreatorAgentHero from "./SessionCreatorAgentHero";
import SessionCreatorOrgMembersPanel from "./SessionCreatorOrgMembersPanel";
import WorkItemAttachmentControl from "./WorkItemAttachmentControl";
import { deriveChatPanelLaunchContext } from "./deriveLaunchContext";
import "./index.scss";
import { withRemotePreflightTimeout } from "./remotePreflightTimeout";
import { buildRemoteTuiCommand } from "./remoteTuiCommand";
import { resolveSessionCreatorAgentHeroContent } from "./resolveSessionCreatorAgentHero";
import { useSessionCreatorChatPanelHandlers } from "./useSessionCreatorChatPanelHandlers";

const log = createLogger("ChatPanel");
const LAUNCH_CLICK_DEBUG_STORAGE_KEY = "orgii:sshRemoteLaunchClickDebug";
const REMOTE_CAPABLE_CLI_AGENTS: ReadonlyArray<string> = [
  "claude_code",
  "codex",
  "gemini_cli",
];

function deriveExpectedProcess(command: string): string | undefined {
  const [binary] = command.trim().split(/\s+/);
  return binary || undefined;
}

function isCliAgentType(
  value: string | null | undefined
): value is CliAgentType {
  return Boolean(value);
}

function formatDebugDetails(
  details: Record<string, unknown> | undefined
): string | null {
  if (!details) return null;
  try {
    return JSON.stringify(details);
  } catch {
    return "[unserializable details]";
  }
}

function persistLaunchClickDebug(state: {
  stage: string;
  message: string;
  timestamp: number;
}): void {
  try {
    window.localStorage.setItem(
      LAUNCH_CLICK_DEBUG_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Debug-only persistence; ignore storage failures.
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionCreatorChatPanelVariant = "default" | "fullScreen";
type SessionCreatorChatPanelHeaderLayout = "hero" | "compact";

export interface SessionCreatorChatPanelProps {
  centerFullScreenContent?: boolean;
  className?: string;
  /** Override classes on the inner content-padding div (e.g. to reduce bottom padding). */
  innerClassName?: string;
  footerSlot?: React.ReactNode;
  leadingActionSlot?: React.ReactNode;
  headerLayout?: SessionCreatorChatPanelHeaderLayout;
  hideRepoLine?: boolean;
  initialContent?: string;
  dropdownDirection?: DropdownDirection;
  onOpenCliTerminal?: (options: ChatPanelCliTerminalLaunchOptions) => void;
  onRegionNoticeChange?: (notice: ChatPanelRegionNotice | null) => void;
  onSessionStart?: (info: SessionLaunchSuccessInfo) => void;
  variant?: SessionCreatorChatPanelVariant;
  workItemContext?: SessionLaunchWorkItemContext;
  resolveWorkItemContext?: () => Promise<SessionLaunchWorkItemContext | null>;
}

interface SessionCreatorChatPanelSingleProps extends SessionCreatorChatPanelProps {
  hidePresenceButton?: boolean;
  launchMode?: SessionCreatorLaunchMode;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SessionCreatorChatPanelSingle: React.FC<
  SessionCreatorChatPanelSingleProps
> = ({
  centerFullScreenContent = false,
  className = "",
  innerClassName,
  footerSlot,
  leadingActionSlot,
  headerLayout = "hero",
  hideRepoLine = false,
  initialContent,
  dropdownDirection = "down",
  onOpenCliTerminal,
  onRegionNoticeChange,
  onSessionStart,
  hidePresenceButton = false,
  launchMode,
  variant = "default",
  workItemContext,
  resolveWorkItemContext,
}) => {
  const { t } = useTranslation("sessions");
  const browserAddToConversationNav = useBrowserAddToConversationAction();
  const { registry } = useAgentCompatibility();
  const { orgs } = useAgentOrgs();
  const { agents: cliAgentList } = useCliAgents({ enabled: true });
  const cliVisibilityOverrides = useAtomValue(cliAgentVisibilityOverridesAtom);
  const enabledCliAgentList = useMemo(
    () =>
      cliAgentList.filter((agent) =>
        isCliAgentEnabled(agent.name, agent.installed, cliVisibilityOverrides)
      ),
    [cliAgentList, cliVisibilityOverrides]
  );

  // Read atoms needed before useSessionCreator so we can pass derived values in.
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const cliLaunchMode = useAtomValue(cliLaunchModeAtom);
  const setCliLaunchMode = useSetAtom(cliLaunchModeAtom);

  const selectedCliAgent = useMemo(
    () =>
      dispatchCategory === "cli_agent" && cliAgentType
        ? enabledCliAgentList.find((agent) => agent.name === cliAgentType)
        : undefined,
    [dispatchCategory, cliAgentType, enabledCliAgentList]
  );
  const selectedCliAgentSupportsGui = selectedCliAgent?.supportsGui === true;
  const selectedCliAgentGuiSupportKnown = Boolean(selectedCliAgent);
  const cliComposerEnabled =
    cliLaunchMode === CLI_LAUNCH_MODE.GUI &&
    (!selectedCliAgentGuiSupportKnown || selectedCliAgentSupportsGui);

  const {
    repos: reposList,
    selectedRepoId,
    selectRepo,
    currentRepo,
    currentBranch,
    branchLoading,
    loadBranchList,
    forceRefreshRepos,
  } = useRepoSelection({ autoLoad: true });
  const [attachedWorkItemContext, setAttachedWorkItemContext] =
    useState<SessionLaunchWorkItemContext | null>(null);
  const selectedProjectOrgContext = useAtomValue(
    chatPanelSelectedProjectOrgAtom
  );
  const selectedProjectContext = useAtomValue(chatPanelSelectedProjectAtom);
  const selectedWorkItemContext = useAtomValue(chatPanelSelectedWorkItemAtom);
  const chatPanelLaunchContext = useMemo(
    () =>
      deriveChatPanelLaunchContext({
        selectedProjectContext,
        selectedProjectOrgContext,
        selectedWorkItemContext,
      }),
    [selectedProjectContext, selectedProjectOrgContext, selectedWorkItemContext]
  );
  const defaultTuiMode = useAtomValue(creatorDefaultTuiModeAtom);
  const setDefaultTuiMode = useSetAtom(creatorDefaultTuiModeAtom);
  const store = useStore();

  const handleSessionStart = useCallback(
    (info: SessionLaunchSuccessInfo) => {
      setAttachedWorkItemContext(null);
      if (defaultTuiMode) {
        store.set(tuiModeAtom(info.sessionId), true);
      }
      onSessionStart?.(info);
    },
    [onSessionStart, defaultTuiMode, store]
  );

  const {
    fileInputRef,
    composerInputRef,
    uploadedFiles,
    isLoading,
    advancedConfig,
    setAdvancedConfig,
    effectiveSource,
    repos,
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    handleFileUpload,
    handleRemoveFile,
    handleUploadClick,
    handleContentChange,
    handleAtMention,
    handleAtMentionClose,
    handleAtMentionClick,
    handleAtSelect,
    handleLaunch: originalHandleLaunch,
    launchDebugState,
    handleBranchChange,
    attachedImages,
    handleImagePaste,
    removeImage,
    canLaunch,
    slashCommandKeyboardHandlerRef,
    showSlashMenu,
    slashQuery,
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect,
    handleModeSelect,
    currentMode,
    filteredSlashItems,
    slashLoading,
  } = useSessionCreator({
    initialContent,
    launchMode,
    persistDraft: !initialContent,
    skipDraftLoading: Boolean(initialContent),
    workItemContext:
      attachedWorkItemContext ?? workItemContext ?? chatPanelLaunchContext,
    resolveWorkItemContext,
    onLaunchSuccess: handleSessionStart,
    cliAgentSupportsGui: cliComposerEnabled,
  });

  const setCreatorState = useSetAtom(sessionCreatorStateAtom);
  const gitInstalled = useAtomValue(gitDependencyInstalledAtom);
  const showMissingGitAlert = gitInstalled === false;
  const targetKind = useAtomValue(sessionTargetKindAtom);
  const selectedAgentDefId = useAtomValue(selectedAgentDefinitionIdAtom);
  const selectedAgentOrgId = useAtomValue(selectedAgentOrgIdAtom);
  const agentName = useAtomValue(agentNameAtom);
  const agentIconId = useAtomValue(agentIconIdAtom);
  const { builtInAgents, agents: customAgents } = useAgentDefinitions();

  const runningLocation = useAtomValue(runningLocationAtom);
  const setRunningLocation = useSetAtom(runningLocationAtom);
  const setSelectedWorktreePath = useSetAtom(selectedWorktreePathAtom);
  const worktreeLaunchSource = useAtomValue(worktreeLaunchSourceAtom);
  const setWorktreeLaunchSource = useSetAtom(worktreeLaunchSourceAtom);

  const handleWorktreeLocationChange = useCallback(
    (location: Parameters<typeof setRunningLocation>[0]) => {
      setSelectedWorktreePath(null);
      if (location !== "worktree") {
        setWorktreeLaunchSource(null);
      }
      setRunningLocation(location);
    },
    [setRunningLocation, setSelectedWorktreePath, setWorktreeLaunchSource]
  );

  const handleWorktreeSourceSelect = useCallback(
    (source: WorktreeLaunchSource) => {
      setSelectedWorktreePath(null);
      setWorktreeLaunchSource(source);
      setRunningLocation("worktree");
      if (source.baseBranch) {
        handleBranchChange(source.baseBranch);
      }
    },
    [
      handleBranchChange,
      setRunningLocation,
      setSelectedWorktreePath,
      setWorktreeLaunchSource,
    ]
  );

  const agentVariant = getRustAgentType(selectedAgentDefId);
  const isRustMode = dispatchCategory === "rust_agent";
  const isOSMode = isRustMode && agentVariant === "os";
  const isSDEMode = isRustMode && agentVariant === "sde";
  const isWingmanMode = isRustMode && agentVariant === "wingman";
  const isCliMode = dispatchCategory === "cli_agent";
  const isCursorIdeMode = dispatchCategory === "cursor_ide";
  const isCliTuiMode = isCliMode && !cliComposerEnabled;

  const [isCategorySelectorOpen, setIsCategorySelectorOpen] = useState(false);
  const openCategoryPickerSignal = useAtomValue(openCategoryPickerSignalAtom);
  const prevOpenCategoryPickerSignalRef = useRef(openCategoryPickerSignal);
  useEffect(() => {
    if (openCategoryPickerSignal !== prevOpenCategoryPickerSignalRef.current) {
      prevOpenCategoryPickerSignalRef.current = openCategoryPickerSignal;
      // Defer out of the effect body to avoid synchronous setState cascades
      queueMicrotask(() => setIsCategorySelectorOpen(true));
    }
  }, [openCategoryPickerSignal]);

  const agentHeroRef = useRef<HTMLButtonElement>(null);
  const workItemPanelHostRef = useRef<HTMLDivElement>(null);
  const setSessionSource = useSetAtom(sessionSourceAtom);
  const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
  const [openOrgMembersPanelId, setOpenOrgMembersPanelId] = useState<
    string | null
  >(null);
  const isOrgMembersPanelOpen =
    targetKind === SESSION_TARGET_KIND.AGENT_ORG &&
    Boolean(selectedAgentOrgId) &&
    openOrgMembersPanelId === selectedAgentOrgId;

  // ── Handlers via extracted hook ───────────────────────────────────────────

  const {
    screenPickerMonitors,
    setScreenPickerMonitors,
    handleShareScreenClick,
    handleScreenPicked,
    handleRepoChange,
    handleRepoSelectForSession,
    requestModelOpen,
    setRequestModelOpen,
    handleCategorySelect,
  } = useSessionCreatorChatPanelHandlers({
    reposList,
    effectiveSource,
    advancedConfig,
    setAdvancedConfig,
    selectRepo,
    forceRefreshRepos,
  });

  const handleAgentPickerSelect = useCallback(
    (selection: AgentSelection) => {
      if (selection.cliAgentType && selection.cliLaunchMode) {
        setCliLaunchMode(selection.cliLaunchMode);
        setDefaultTuiMode(selection.cliLaunchMode === CLI_LAUNCH_MODE.TUI);
      }
      handleCategorySelect(selection);
    },
    [handleCategorySelect, setCliLaunchMode, setDefaultTuiMode]
  );

  const handleAdvancedConfigChange = useCallback(
    (config: typeof advancedConfig) => {
      setAdvancedConfig(config);
    },
    [setAdvancedConfig]
  );

  useEffect(() => {
    if (!effectiveSource) return;
    if (effectiveSource.type !== "local") return;
    if (!effectiveSource.repoId) return;
    if (effectiveSource.repoId !== selectedRepoId) return;
    if (currentRepo?.kind === REPO_KIND.FOLDER) return;
    if (!currentBranch) return;
    if (effectiveSource.branch) return;

    setSessionSource({
      ...effectiveSource,
      branch: currentBranch,
    });
  }, [
    currentBranch,
    currentRepo?.kind,
    effectiveSource,
    selectedRepoId,
    setSessionSource,
  ]);

  // ── Restore text ──────────────────────────────────────────────────────────

  const restoreToInput = useAtomValue(restoreToInputAtom);
  const setImageAttachments = useSetAtom(chatImageAttachmentsAtom);
  const [initialRestoreText] = useState<string>(() => {
    return store.get(restoreToInputAtom)?.displayContent ?? "";
  });

  // ── Draft content tracking ────────────────────────────────────────────────

  const setDraftHasContent = useSetAtom(draftHasContentAtom);

  const handleContentChangeWithTracking = useCallback(
    (text: string) => {
      setDraftHasContent(text.trim().length > 0);
      handleContentChange?.(text);
    },
    [handleContentChange, setDraftHasContent]
  );

  useEffect(() => {
    if (!restoreToInput?.displayContent) return;
    const editor = composerInputRef.current;
    if (!editor) return;
    const restoredText = restoreToInput.displayContent;
    editor.setContent(restoredText);
    editor.focus();
    handleContentChangeWithTracking(restoredText);
    if (restoreToInput.imageDataUrls?.length) {
      const restoredImages: ChatImageAttachment[] =
        restoreToInput.imageDataUrls.map((dataUrl, idx) => ({
          id: `restored_${Date.now()}_${idx}`,
          dataUrl,
          fileName: `restored-image-${idx + 1}.png`,
          size: 0,
          width: 0,
          height: 0,
        }));
      setImageAttachments((prev) => [
        ...prev.filter((image) => image.ownerId),
        ...restoredImages,
      ]);
    }
    store.set(restoreToInputAtom, null);
    store.set(draftHasContentAtom, restoredText.trim().length > 0);
  }, [
    restoreToInput,
    composerInputRef,
    handleContentChangeWithTracking,
    setImageAttachments,
    store,
  ]);

  useEffect(() => {
    return () => {
      setDraftHasContent(false);
    };
  }, [setDraftHasContent]);

  // ── Launch ────────────────────────────────────────────────────────────────

  const [launchClickDebug, setLaunchClickDebug] = useState<{
    stage: string;
    message: string;
    timestamp: number;
  } | null>(null);

  const handleLaunch = useCallback(async () => {
    const remoteTarget = advancedConfig.remoteTarget;
    const clickedDebug = {
      stage: "clicked",
      message: `dispatch=${dispatchCategory}, canLaunch=${canLaunch}, loading=${isLoading}, remote=${remoteTarget?.host?.trim() || "none"}, dir=${remoteTarget?.workingDir?.trim() || "none"}`,
      timestamp: Date.now(),
    };
    setLaunchClickDebug(clickedDebug);
    persistLaunchClickDebug(clickedDebug);

    if (
      isCliTuiMode &&
      onOpenCliTerminal &&
      selectedCliAgent &&
      isCliAgentType(cliAgentType)
    ) {
      const command = selectedCliAgent.command.trim();
      if (command.length > 0) {
        const tuiDebug = {
          stage: "tui_terminal",
          message: `Opening CLI terminal for ${cliAgentType}`,
          timestamp: Date.now(),
        };
        setLaunchClickDebug(tuiDebug);
        persistLaunchClickDebug(tuiDebug);
        onOpenCliTerminal({
          cliAgentType,
          command,
          title: selectedCliAgent.displayName,
          cwd: effectiveSource?.repoPath,
          expectedProcess: deriveExpectedProcess(command),
        });
        setAttachedWorkItemContext(null);
        return;
      }
    }

    const launched = await originalHandleLaunch();
    const delegatedDebug = {
      stage: launched ? "delegated_ok" : "delegated_false",
      message: `originalHandleLaunch returned ${String(launched)}`,
      timestamp: Date.now(),
    };
    setLaunchClickDebug(delegatedDebug);
    persistLaunchClickDebug(delegatedDebug);
    return launched;
  }, [
    advancedConfig.remoteTarget,
    canLaunch,
    cliAgentType,
    dispatchCategory,
    effectiveSource?.repoPath,
    isLoading,
    isCliTuiMode,
    onOpenCliTerminal,
    originalHandleLaunch,
    selectedCliAgent,
  ]);

  const handleCliLaunchModeChange = useCallback(
    (mode: typeof cliLaunchMode) => {
      if (mode === CLI_LAUNCH_MODE.GUI && !selectedCliAgentSupportsGui) return;
      setCliLaunchMode(mode);
      setDefaultTuiMode(mode === CLI_LAUNCH_MODE.TUI);
    },
    [selectedCliAgentSupportsGui, setCliLaunchMode, setDefaultTuiMode]
  );

  useEffect(() => {
    if (!selectedRepoId) return;
    if (currentRepo?.kind === REPO_KIND.FOLDER) return;
    loadBranchList();
  }, [selectedRepoId, loadBranchList, currentRepo?.kind]);

  // ── Hero section ──────────────────────────────────────────────────────────

  const sessionRepoId = effectiveSource?.repoId ?? "";
  const sessionRepo = useMemo(
    () => repos.find((repoItem) => repoItem.id === sessionRepoId),
    [repos, sessionRepoId]
  );
  const repoDisplayName = effectiveSource?.repoName ?? sessionRepo?.name;
  const effectiveBranchName = effectiveSource?.branch;
  const sessionRepoKind = sessionRepo?.kind ?? currentRepo?.kind;
  const currentRepoPath = effectiveSource?.repoPath ?? "";

  const allAgentDefinitions = useMemo(
    () => [...builtInAgents, ...customAgents],
    [builtInAgents, customAgents]
  );

  const selectedAgentDefinition = useMemo(
    () =>
      selectedAgentDefId
        ? allAgentDefinitions.find((agent) => agent.id === selectedAgentDefId)
        : undefined,
    [allAgentDefinitions, selectedAgentDefId]
  );

  const selectedOrg = useMemo(
    () =>
      targetKind === SESSION_TARGET_KIND.AGENT_ORG && selectedAgentOrgId
        ? orgs.find((org) => org.id === selectedAgentOrgId)
        : undefined,
    [targetKind, selectedAgentOrgId, orgs]
  );

  // Workstation hides this creator while a session is active
  // (`jumpToSession(sessionId)`) and remounts it when the user returns
  // to a blank creator tab (`jumpToSession(null)`). Rehydrate the
  // selected agent display fields from Rust definitions so the hero
  // icon/name survive that lifecycle even if the persisted creator
  // state only kept `selectedAgentDefinitionId`.
  useEffect(() => {
    if (!selectedAgentDefId || !selectedAgentDefinition) return;
    setCreatorState((previous) => {
      if (previous.selectedAgentDefinitionId !== selectedAgentDefId) {
        return previous;
      }
      const nextAgentName = selectedAgentDefinition.name;
      const nextAgentIconId = selectedAgentDefinition.iconId ?? null;
      if (
        previous.agentName === nextAgentName &&
        previous.agentIconId === nextAgentIconId
      ) {
        return previous;
      }
      return {
        ...previous,
        agentName: nextAgentName,
        agentIconId: nextAgentIconId,
      };
    });
  }, [selectedAgentDefId, selectedAgentDefinition, setCreatorState]);

  const resolvedAgentName = selectedAgentDefinition?.name ?? agentName;
  const resolvedAgentIconId = selectedAgentDefinition?.iconId || agentIconId;
  const hasAgentSelected = !!(
    (isCliMode && cliAgentType) ||
    (targetKind === SESSION_TARGET_KIND.AGENT_ORG && selectedAgentOrgId) ||
    selectedAgentDefId ||
    resolvedAgentName
  );

  const createAgentSelectorIcon = useCallback(
    (size: number) => {
      if (isCliMode && cliAgentType) {
        return <ModelIcon agentType={cliAgentType as ModelType} size={size} />;
      }
      if (isCursorIdeMode) {
        return <ModelIcon agentType="cursor_cli" size={size} />;
      }
      if (isRustMode) {
        const iconId = resolvedAgentIconId || "code";
        return React.createElement(resolveAgentIcon(iconId), {
          size,
          strokeWidth: 1.75,
          className: hasAgentSelected ? "text-text-1" : "text-primary-6",
        });
      }
      return null;
    },
    [
      isRustMode,
      isCliMode,
      isCursorIdeMode,
      cliAgentType,
      resolvedAgentIconId,
      hasAgentSelected,
    ]
  );

  const heroIcon = useMemo(
    () => createAgentSelectorIcon(20),
    [createAgentSelectorIcon]
  );
  const compactHeaderIcon = useMemo(
    () => createAgentSelectorIcon(14),
    [createAgentSelectorIcon]
  );

  const heroContent = useMemo(
    () =>
      resolveSessionCreatorAgentHeroContent({
        hasAgentSelected,
        dispatchCategory,
        targetKind,
        selectedAgentDefinition,
        resolvedAgentName,
        cliAgentType,
        selectedAgentOrgId,
        orgs,
        agentRegistry: registry,
        isOSMode,
      }),
    [
      hasAgentSelected,
      dispatchCategory,
      targetKind,
      selectedAgentDefinition,
      resolvedAgentName,
      cliAgentType,
      selectedAgentOrgId,
      orgs,
      registry,
      isOSMode,
    ]
  );

  const regionModelType = useMemo(
    () =>
      getBigThreeRegionModelTypeForSession(
        dispatchCategory,
        advancedConfig,
        cliAgentType
      ),
    [dispatchCategory, advancedConfig, cliAgentType]
  );

  const regionCheck = useRegionCheck(regionModelType);
  const regionNotice = useMemo<ChatPanelRegionNotice | null>(() => {
    if (regionModelType === "" || regionCheck.status === "loading") {
      return null;
    }

    const sanctioned =
      regionCheck.countryCode && isRegionSanctioned(regionCheck.countryCode);
    const providerRestricted = regionCheck.status === "unsupported";
    if (!providerRestricted && !sanctioned) {
      return null;
    }

    const location = regionCheck.locationText || regionCheck.countryCode || "";
    const body = providerRestricted
      ? sanctioned
        ? t("creator.regionNoticeBodyBoth", { location })
        : t("creator.regionNoticeBodyProvider", { location })
      : t("creator.regionNoticeBodySanctions", { location });

    return {
      key: `${regionModelType}:${regionCheck.countryCode ?? "unknown"}:${regionCheck.status}`,
      title: t("creator.regionNoticeTitle"),
      body,
    };
  }, [
    regionModelType,
    regionCheck.status,
    regionCheck.countryCode,
    regionCheck.locationText,
    t,
  ]);

  useEffect(() => {
    onRegionNoticeChange?.(regionNotice);
    return () => onRegionNoticeChange?.(null);
  }, [onRegionNoticeChange, regionNotice]);

  const isFullScreenVariant = variant === "fullScreen";

  const handleToggleOrgMembers = useCallback(() => {
    setOpenOrgMembersPanelId((currentId) =>
      currentId === selectedAgentOrgId ? null : (selectedAgentOrgId ?? null)
    );
  }, [selectedAgentOrgId]);

  const displayedRepoId =
    isOSMode && !sessionRepoId ? SYSTEM_HOME_SOURCE_ID : sessionRepoId;
  const displayedRepoName =
    isOSMode && !repoDisplayName
      ? getSystemHomeSourceLabel(t)
      : repoDisplayName;
  const isDisplayedSystemPath = isSystemPathSourceId(displayedRepoId);

  const sessionInfoLine = (
    <SessionInfoLine
      repoId={displayedRepoId}
      repoName={displayedRepoName}
      repoPath={currentRepoPath}
      onRepoChange={handleRepoChange}
      onRepoSelect={handleRepoSelectForSession}
      repoKind={sessionRepoKind}
      includeSystemPaths={isOSMode || isSDEMode}
      branchName={isOSMode && !sessionRepoId ? undefined : effectiveBranchName}
      branchLoading={branchLoading && !effectiveBranchName}
      onBranchChange={handleBranchChange}
      worktreeLocation={isDisplayedSystemPath ? undefined : runningLocation}
      worktreeSourceLabel={
        runningLocation === "worktree" ? worktreeLaunchSource?.label : undefined
      }
      onWorktreeLocationChange={handleWorktreeLocationChange}
      onWorktreeSourceSelect={handleWorktreeSourceSelect}
      fullWidth
      pillVariant={headerLayout === "compact" ? "ghost" : undefined}
    />
  );

  const repoPills = (
    <div className="flex w-full justify-center">
      <div
        className={`flex w-full flex-wrap items-center justify-start gap-0.5 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
      >
        {sessionInfoLine}
      </div>
    </div>
  );

  const cliLaunchModeSwitch = isCliMode && (
    <CliLaunchModeSwitch
      mode={cliLaunchMode}
      supportsGui={
        !selectedCliAgentGuiSupportKnown || selectedCliAgentSupportsGui
      }
      onModeChange={handleCliLaunchModeChange}
    />
  );

  const compactHeader = headerLayout === "compact" && (
    <div className="session-creator-chat-panel-compact-header flex w-full items-center justify-between gap-2 bg-bg-2 px-1 pb-2 pt-1">
      <SelectorPill
        ref={agentHeroRef}
        icon={compactHeaderIcon}
        label={heroContent.name}
        active={isCategorySelectorOpen}
        danger={heroContent.danger}
        size="md"
        tooltip={t("creator.switchAgent")}
        tooltipPosition="top"
        onClick={() => setIsCategorySelectorOpen(true)}
        ariaLabel={heroContent.name}
        variant="ghost"
      />
      <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-0.5">
        {sessionInfoLine}
      </div>
    </div>
  );

  const browserElementScrollNav = useMemo<ScrollNavState>(
    () => ({
      showScrollToBottom: false,
      onScrollToBottom: () => undefined,
      showFollowAgent: false,
      followAgentLabel: "",
      followAgentTooltipLabel: "",
      followAgentShortcut: "",
      onFollowAgent: () => undefined,
      ...browserAddToConversationNav,
    }),
    [browserAddToConversationNav]
  );
  const browserElementRowContent =
    browserElementScrollNav.showAddToConversation ? (
      <CollapsedInlineRow sections={[]} scrollNav={browserElementScrollNav} />
    ) : null;

  // ── Remote SSH connection health check (§3-Phase3) ──────────────────────
  // A "Test connection" affordance next to the Remote SSH inputs: proves SSH
  // connectivity (BatchMode auth) + that the CLI binary is on the remote PATH
  // *before* the user commits to creating a session.
  const remoteHost = advancedConfig.remoteTarget?.host?.trim() ?? "";
  // The verdict carries the host/port/dir key it was run against; a
  // `done`/`checking` verdict is only honoured while that target is still
  // current. That naturally invalidates a stale result when the user edits the
  // inputs — no effect, no manual reset (avoids setState-in-effect + React-
  // Compiler memo friction).
  const [remotePreflightState, setRemotePreflightState] = useState<
    | { kind: "idle" }
    | { kind: "checking"; key: string }
    | { kind: "done"; key: string; result: RemotePreflightResult }
  >({ kind: "idle" });
  const [remoteTargetExpanded, setRemoteTargetExpanded] = useState(false);
  const remotePort = advancedConfig.remoteTarget?.port;
  const remoteWorkingDir =
    advancedConfig.remoteTarget?.workingDir?.trim() ?? "";
  const remotePreflightKey = `${remoteHost}:${remotePort ?? ""}:${remoteWorkingDir}`;
  const preflightChecking =
    remotePreflightState.kind === "checking" &&
    remotePreflightState.key === remotePreflightKey;
  const preflightResult =
    remotePreflightState.kind === "done" &&
    remotePreflightState.key === remotePreflightKey
      ? remotePreflightState.result
      : null;
  const preflightOk =
    !!preflightResult &&
    preflightResult.connected &&
    preflightResult.binaryFound !== false &&
    preflightResult.dirOk !== false &&
    preflightResult.runtimeOk !== false;
  const remoteTargetDisplay = buildRemoteTargetDisplay({
    host: remoteHost,
    port: remotePort,
    workspacePath: remoteWorkingDir,
  });
  const launchDebugDetails = formatDebugDetails(launchDebugState?.details);

  const runRemotePreflight = async () => {
    if (!remoteHost) return;
    setRemotePreflightState({ kind: "checking", key: remotePreflightKey });
    try {
      const result = await withRemotePreflightTimeout(
        remotePreflight({
          host: remoteHost,
          port: remotePort,
          cliAgentType: advancedConfig.cliAgentType ?? undefined,
          workingDir: remoteWorkingDir || undefined,
        })
      );
      setRemotePreflightState({
        kind: "done",
        key: remotePreflightKey,
        result,
      });
    } catch (err) {
      // rpc throws on transport errors; surface them with the same shape.
      const message = err instanceof Error ? err.message : String(err);
      setRemotePreflightState({
        kind: "done",
        key: remotePreflightKey,
        result: {
          connected: false,
          binaryFound: null,
          dirOk: null,
          runtimeOk: null,
          summary: message,
          error: message,
        },
      });
    }
  };

  // SSH-remote milestone (§3-Phase3): offer a manual Remote SSH target entry
  // for the line-based CLIs that support it (cursor_cli/copilot/kiro are
  // MITM/ACP and can't run remote yet). Hosted+Remote is rejected server-side.
  const showRemoteTargetInput =
    isCliMode &&
    !!cliAgentType &&
    REMOTE_CAPABLE_CLI_AGENTS.includes(cliAgentType);
  const remoteLaunchConfigured = showRemoteTargetInput && remoteHost.length > 0;
  const remoteLaunchDisabled = isLoading || !preflightOk;
  const handleComposerLaunch = useCallback(async () => {
    if (remoteLaunchConfigured) {
      setRemoteTargetExpanded(true);
      return false;
    }
    return handleLaunch();
  }, [handleLaunch, remoteLaunchConfigured, setRemoteTargetExpanded]);
  const handleRemoteTuiLaunch = useCallback(async () => {
    if (!preflightOk || !selectedCliAgent || !isCliAgentType(cliAgentType)) {
      return false;
    }
    const command = selectedCliAgent.command.trim();
    if (!command || !remoteHost) return false;
    const remoteTitle = remoteTargetDisplay?.hostLabel ?? remoteHost;
    const tuiDebug = {
      stage: "tui_remote_terminal",
      message: `Opening remote CLI terminal for ${cliAgentType} on ${remoteHost}`,
      timestamp: Date.now(),
    };
    setLaunchClickDebug(tuiDebug);
    persistLaunchClickDebug(tuiDebug);
    TerminalService.openCliTerminal({
      cliAgentType,
      command: buildRemoteTuiCommand({
        command,
        host: remoteHost,
        port: remotePort,
        workingDir: remoteWorkingDir || undefined,
      }),
      title: `${selectedCliAgent.displayName} · ${remoteTitle}`,
      expectedProcess: "ssh",
    });
    setAttachedWorkItemContext(null);
    return true;
  }, [
    cliAgentType,
    preflightOk,
    remoteHost,
    remotePort,
    remoteTargetDisplay?.hostLabel,
    remoteWorkingDir,
    selectedCliAgent,
  ]);

  const editorArea = (
    <EditorArea
      variant="chatPanelFullScreen"
      uploadedFiles={uploadedFiles}
      onRemoveFile={handleRemoveFile}
      composerInputRef={composerInputRef}
      onContentChange={handleContentChangeWithTracking}
      onAtMention={handleAtMention}
      onAtMentionClose={handleAtMentionClose}
      onSubmit={handleComposerLaunch}
      showContextMenu={showContextMenu}
      setShowContextMenu={setShowContextMenu}
      atSearchQuery={atSearchQuery}
      setAtSearchQuery={setAtSearchQuery}
      onAtSelect={handleAtSelect}
      repoPath={currentRepoPath}
      onAtMentionClick={handleAtMentionClick}
      onUploadClick={handleUploadClick}
      isLoading={isLoading}
      onLaunch={handleComposerLaunch}
      advancedConfig={advancedConfig}
      onAdvancedConfigChange={handleAdvancedConfigChange}
      hideInfoLine={true}
      repoId={displayedRepoId}
      repoName={displayedRepoName}
      repoKind={isOSMode && !sessionRepoId ? undefined : currentRepo?.kind}
      branchName={isOSMode && !sessionRepoId ? undefined : effectiveBranchName}
      onBranchChange={handleBranchChange}
      onImagePaste={handleImagePaste}
      attachedImages={attachedImages}
      onRemoveImage={removeImage}
      launchDisabled={!canLaunch}
      requestModelOpen={requestModelOpen}
      onModelOpenHandled={() => setRequestModelOpen(false)}
      shellClassName="session-creator-chat-panel-fullscreen-input-shell"
      initialContent={initialRestoreText || initialContent || undefined}
      autoFocus
      showSlashMenu={showSlashMenu}
      slashQuery={slashQuery}
      slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
      onSlashCommand={handleSlashCommand}
      onSlashCommandClose={handleSlashCommandClose}
      onSlashSelect={handleSlashSelect}
      onModeSelect={handleModeSelect}
      currentMode={currentMode}
      filteredSlashItems={filteredSlashItems}
      slashLoading={slashLoading}
      dropdownDirection={dropdownDirection}
    />
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`session-creator-chat-panel-wrapper ${className}`}
      data-testid="session-creator-chat-panel"
    >
      <div
        className={`session-creator-chat-panel-content flex min-h-0 flex-1 items-center justify-center px-4 ${DETAIL_PANEL_TOKENS.headerWidth} ${
          innerClassName ??
          (isFullScreenVariant
            ? centerFullScreenContent
              ? "pb-[10vh]"
              : "pb-[18vh]"
            : "pb-[4vh]")
        }`}
      >
        <div className="flex w-full flex-col items-stretch gap-3">
          {isCliTuiMode ? (
            <>
              {headerLayout !== "compact" && (
                <SessionCreatorAgentHero
                  ref={agentHeroRef}
                  name={heroContent.name}
                  description={heroContent.description}
                  avatarIcon={heroIcon}
                  active={isCategorySelectorOpen}
                  danger={heroContent.danger}
                  onClick={() => setIsCategorySelectorOpen(true)}
                />
              )}

              <div
                className={`session-creator-chat-panel-fullscreen-composer w-full ${
                  headerLayout === "compact"
                    ? "session-creator-chat-panel-fullscreen-composer-compact"
                    : ""
                }`}
              >
                {compactHeader}
                <div className="rounded-xl bg-chat-container p-3">
                  <button
                    type="button"
                    onClick={handleLaunch}
                    disabled={!canLaunch || isLoading}
                    className="flex w-full items-center justify-center rounded-full bg-primary-6 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-primary-7 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("creator.start")}
                  </button>
                </div>
                {!hideRepoLine && headerLayout !== "compact" && (
                  <div className="session-creator-chat-panel-fullscreen-repo-row px-1 pb-2 pt-3">
                    {repoPills}
                  </div>
                )}
                {showRemoteTargetInput && (
                  <>
                    <div className="px-1 pb-1 pt-2">
                      <div className="rounded-md border border-border-2 bg-fill-1/40">
                        <button
                          type="button"
                          aria-expanded={remoteTargetExpanded}
                          onClick={() =>
                            setRemoteTargetExpanded((expanded) => !expanded)
                          }
                          className="flex min-h-[34px] w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-fill-2/50 focus-visible:ring-1 focus-visible:ring-primary-4"
                        >
                          <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-1">
                            {remoteTargetExpanded ? (
                              <ChevronDown
                                size={13}
                                strokeWidth={1.75}
                                className="shrink-0 text-text-4"
                              />
                            ) : (
                              <ChevronRight
                                size={13}
                                strokeWidth={1.75}
                                className="shrink-0 text-text-4"
                              />
                            )}
                            <Network
                              size={14}
                              strokeWidth={1.75}
                              className="shrink-0"
                            />
                            <span className="shrink-0">Run on remote</span>
                            {remoteTargetDisplay && (
                              <span
                                className="min-w-0 truncate text-text-3"
                                title={remoteTargetDisplay.title}
                              >
                                {remoteTargetDisplay.hostLabel}
                                {remoteTargetDisplay.workspaceLabel
                                  ? ` · ${remoteTargetDisplay.workspaceLabel}`
                                  : ""}
                              </span>
                            )}
                          </div>
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {preflightChecking ? (
                              <Loader2
                                size={12}
                                className="animate-spin text-text-4"
                              />
                            ) : preflightOk ? (
                              <CheckCircle2
                                size={12}
                                className="text-emerald-600"
                              />
                            ) : preflightResult ? (
                              <AlertCircle size={12} className="text-red-600" />
                            ) : null}
                          </span>
                        </button>
                        {remoteTargetExpanded && (
                          <div className="border-t border-border-2 px-2.5 pb-2 pt-2">
                            <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2 text-[12px] text-text-3">
                              <label className="min-w-0">
                                <span className="mb-1 block text-[11px] text-text-4">
                                  Host
                                </span>
                                <input
                                  type="text"
                                  spellCheck={false}
                                  autoComplete="off"
                                  data-testid="remote-ssh-host-input"
                                  className="bg-background h-[26px] w-full min-w-0 rounded border border-border-2 px-2 text-text-1 outline-none focus:border-primary-4"
                                  placeholder="user@host"
                                  value={
                                    advancedConfig.remoteTarget?.host ?? ""
                                  }
                                  onChange={(e) =>
                                    handleAdvancedConfigChange({
                                      ...advancedConfig,
                                      remoteTarget: {
                                        host: e.target.value,
                                        port: advancedConfig.remoteTarget?.port,
                                        workingDir:
                                          advancedConfig.remoteTarget
                                            ?.workingDir,
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label>
                                <span className="mb-1 block text-[11px] text-text-4">
                                  Port
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={65535}
                                  data-testid="remote-ssh-port-input"
                                  className="bg-background h-[26px] w-full rounded border border-border-2 px-2 text-text-1 outline-none focus:border-primary-4"
                                  placeholder="22"
                                  value={
                                    advancedConfig.remoteTarget?.port ?? ""
                                  }
                                  onChange={(e) =>
                                    handleAdvancedConfigChange({
                                      ...advancedConfig,
                                      remoteTarget: {
                                        host:
                                          advancedConfig.remoteTarget?.host ??
                                          "",
                                        port: e.target.value
                                          ? Number(e.target.value)
                                          : undefined,
                                        workingDir:
                                          advancedConfig.remoteTarget
                                            ?.workingDir,
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label className="col-span-2 min-w-0">
                                <span className="mb-1 block text-[11px] text-text-4">
                                  Working target
                                </span>
                                <input
                                  type="text"
                                  spellCheck={false}
                                  autoComplete="off"
                                  data-testid="remote-ssh-working-dir-input"
                                  className="bg-background h-[26px] w-full min-w-0 rounded border border-border-2 px-2 text-text-1 outline-none focus:border-primary-4"
                                  placeholder="/home/qlg/wkspaces/ORG2"
                                  value={
                                    advancedConfig.remoteTarget?.workingDir ??
                                    ""
                                  }
                                  onChange={(e) =>
                                    handleAdvancedConfigChange({
                                      ...advancedConfig,
                                      remoteTarget: {
                                        host:
                                          advancedConfig.remoteTarget?.host ??
                                          "",
                                        port: advancedConfig.remoteTarget?.port,
                                        workingDir: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={runRemotePreflight}
                                disabled={!remoteHost || preflightChecking}
                                data-testid="remote-ssh-test-button"
                                className={`flex h-[24px] shrink-0 items-center gap-1 rounded border px-2 text-[11px] outline-none transition-colors focus:border-primary-4 disabled:opacity-50 ${
                                  preflightOk
                                    ? "border-emerald-300 text-emerald-700"
                                    : "border-border-2 text-text-2 hover:text-text-1"
                                }`}
                              >
                                {preflightChecking ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : preflightOk ? (
                                  <CheckCircle2 size={12} />
                                ) : null}
                                {preflightOk ? "Connected" : "Test"}
                              </button>
                              <button
                                type="button"
                                onClick={handleRemoteTuiLaunch}
                                disabled={remoteLaunchDisabled}
                                data-testid="remote-ssh-launch-button"
                                className="flex h-[24px] shrink-0 items-center gap-1 rounded bg-primary-6 px-2.5 text-[11px] font-medium text-white outline-none transition-colors hover:bg-primary-7 focus-visible:ring-1 focus-visible:ring-primary-4 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Play
                                  size={11}
                                  fill="currentColor"
                                  strokeWidth={0}
                                />
                                {t("creator.start")}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {remoteTargetExpanded && preflightResult && (
                      <div
                        data-testid="remote-ssh-test-result"
                        className={`flex items-start gap-1.5 px-1 pb-1 text-[12px] ${
                          preflightOk ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {preflightOk ? (
                          <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                        ) : (
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        )}
                        <span className="min-w-0 break-words">
                          {preflightResult.summary}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {headerLayout !== "compact" && (
                <>
                  <SessionCreatorAgentHero
                    ref={agentHeroRef}
                    name={heroContent.name}
                    description={heroContent.description}
                    avatarIcon={heroIcon}
                    active={isCategorySelectorOpen}
                    danger={heroContent.danger}
                    onClick={() => setIsCategorySelectorOpen(true)}
                  />
                </>
              )}

              {isWingmanMode && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full border border-dashed border-border-2 px-3 py-1.5 text-[12px] text-text-3 transition-colors hover:border-primary-4 hover:text-primary-6"
                  onClick={() => {
                    handleShareScreenClick().catch(log.error);
                  }}
                >
                  <Airplay size={13} strokeWidth={1.75} />
                  {t("chat.shareScreen")}
                </button>
              )}

              <div
                className={`session-creator-chat-panel-fullscreen-composer w-full ${
                  headerLayout === "compact"
                    ? "session-creator-chat-panel-fullscreen-composer-compact"
                    : ""
                }`}
              >
                {compactHeader}
                {editorArea}
                {!hideRepoLine && headerLayout !== "compact" && (
                  <div className="session-creator-chat-panel-fullscreen-repo-row px-1 pb-2 pt-3">
                    {repoPills}
                  </div>
                )}
                {showRemoteTargetInput && (
                  <>
                    <div className="px-1 pb-1 pt-2">
                      <div className="rounded-md border border-border-2 bg-fill-1/40">
                        <button
                          type="button"
                          aria-expanded={remoteTargetExpanded}
                          onClick={() =>
                            setRemoteTargetExpanded((expanded) => !expanded)
                          }
                          className="flex min-h-[34px] w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-fill-2/50 focus-visible:ring-1 focus-visible:ring-primary-4"
                        >
                          <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-1">
                            {remoteTargetExpanded ? (
                              <ChevronDown
                                size={13}
                                strokeWidth={1.75}
                                className="shrink-0 text-text-4"
                              />
                            ) : (
                              <ChevronRight
                                size={13}
                                strokeWidth={1.75}
                                className="shrink-0 text-text-4"
                              />
                            )}
                            <Network
                              size={14}
                              strokeWidth={1.75}
                              className="shrink-0"
                            />
                            <span className="shrink-0">Run on remote</span>
                            {remoteTargetDisplay && (
                              <span
                                className="min-w-0 truncate text-text-3"
                                title={remoteTargetDisplay.title}
                              >
                                {remoteTargetDisplay.hostLabel}
                                {remoteTargetDisplay.workspaceLabel
                                  ? ` · ${remoteTargetDisplay.workspaceLabel}`
                                  : ""}
                              </span>
                            )}
                          </div>
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {preflightChecking ? (
                              <Loader2
                                size={12}
                                className="animate-spin text-text-4"
                              />
                            ) : preflightOk ? (
                              <CheckCircle2
                                size={12}
                                className="text-emerald-600"
                              />
                            ) : preflightResult ? (
                              <AlertCircle size={12} className="text-red-600" />
                            ) : null}
                          </span>
                        </button>
                        {remoteTargetExpanded && (
                          <div className="border-t border-border-2 px-2.5 pb-2 pt-2">
                            <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2 text-[12px] text-text-3">
                              <label className="min-w-0">
                                <span className="mb-1 block text-[11px] text-text-4">
                                  Host
                                </span>
                                <input
                                  type="text"
                                  spellCheck={false}
                                  autoComplete="off"
                                  data-testid="remote-ssh-host-input"
                                  className="bg-background h-[26px] w-full min-w-0 rounded border border-border-2 px-2 text-text-1 outline-none focus:border-primary-4"
                                  placeholder="user@host"
                                  value={
                                    advancedConfig.remoteTarget?.host ?? ""
                                  }
                                  onChange={(e) =>
                                    handleAdvancedConfigChange({
                                      ...advancedConfig,
                                      remoteTarget: {
                                        host: e.target.value,
                                        port: advancedConfig.remoteTarget?.port,
                                        workingDir:
                                          advancedConfig.remoteTarget
                                            ?.workingDir,
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label>
                                <span className="mb-1 block text-[11px] text-text-4">
                                  Port
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={65535}
                                  data-testid="remote-ssh-port-input"
                                  className="bg-background h-[26px] w-full rounded border border-border-2 px-2 text-text-1 outline-none focus:border-primary-4"
                                  placeholder="22"
                                  value={
                                    advancedConfig.remoteTarget?.port ?? ""
                                  }
                                  onChange={(e) =>
                                    handleAdvancedConfigChange({
                                      ...advancedConfig,
                                      remoteTarget: {
                                        host:
                                          advancedConfig.remoteTarget?.host ??
                                          "",
                                        port: e.target.value
                                          ? Number(e.target.value)
                                          : undefined,
                                        workingDir:
                                          advancedConfig.remoteTarget
                                            ?.workingDir,
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label className="col-span-2 min-w-0">
                                <span className="mb-1 block text-[11px] text-text-4">
                                  Working target
                                </span>
                                <input
                                  type="text"
                                  spellCheck={false}
                                  autoComplete="off"
                                  data-testid="remote-ssh-working-dir-input"
                                  className="bg-background h-[26px] w-full min-w-0 rounded border border-border-2 px-2 text-text-1 outline-none focus:border-primary-4"
                                  placeholder="/home/qlg/wkspaces/ORG2"
                                  value={
                                    advancedConfig.remoteTarget?.workingDir ??
                                    ""
                                  }
                                  onChange={(e) =>
                                    handleAdvancedConfigChange({
                                      ...advancedConfig,
                                      remoteTarget: {
                                        host:
                                          advancedConfig.remoteTarget?.host ??
                                          "",
                                        port: advancedConfig.remoteTarget?.port,
                                        workingDir: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={runRemotePreflight}
                                disabled={!remoteHost || preflightChecking}
                                data-testid="remote-ssh-test-button"
                                className={`flex h-[24px] shrink-0 items-center gap-1 rounded border px-2 text-[11px] outline-none transition-colors focus:border-primary-4 disabled:opacity-50 ${
                                  preflightOk
                                    ? "border-emerald-300 text-emerald-700"
                                    : "border-border-2 text-text-2 hover:text-text-1"
                                }`}
                              >
                                {preflightChecking ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : preflightOk ? (
                                  <CheckCircle2 size={12} />
                                ) : null}
                                {preflightOk ? "Connected" : "Test"}
                              </button>
                              <button
                                type="button"
                                onClick={handleLaunch}
                                disabled={remoteLaunchDisabled}
                                data-testid="remote-ssh-launch-button"
                                className="flex h-[24px] shrink-0 items-center gap-1 rounded bg-primary-6 px-2.5 text-[11px] font-medium text-white outline-none transition-colors hover:bg-primary-7 focus-visible:ring-1 focus-visible:ring-primary-4 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Play
                                  size={11}
                                  fill="currentColor"
                                  strokeWidth={0}
                                />
                                {t("creator.start")}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {remoteTargetExpanded &&
                      (launchClickDebug || launchDebugState) && (
                        <div
                          data-testid="remote-launch-debug"
                          className="space-y-0.5 px-1 pb-1 font-mono text-[10px] leading-4 text-text-4"
                        >
                          {launchClickDebug && (
                            <div className="break-words">
                              Click[{launchClickDebug.stage}]:{" "}
                              {launchClickDebug.message}
                            </div>
                          )}
                          {launchDebugState && (
                            <div className="break-words">
                              Pipeline[{launchDebugState.stage}]:{" "}
                              {launchDebugState.message}
                            </div>
                          )}
                          {launchDebugDetails && (
                            <div className="break-all">
                              Details: {launchDebugDetails}
                            </div>
                          )}
                        </div>
                      )}
                    {remoteTargetExpanded && preflightResult && (
                      <div
                        data-testid="remote-ssh-test-result"
                        className={`flex items-start gap-1.5 px-1 pb-1 text-[12px] ${
                          preflightOk ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {preflightOk ? (
                          <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                        ) : (
                          <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        )}
                        <span className="min-w-0 break-words">
                          {preflightResult.summary}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {showMissingGitAlert && (
            <div
              className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
            >
              <InlineAlert type="warning" title={t("creator.missingGit.title")}>
                {t("creator.missingGit.body")}
              </InlineAlert>
            </div>
          )}

          <div
            className={`mx-auto flex w-full items-center ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
          >
            <PinnedActionsBar
              composerInputRef={
                composerInputRef as React.RefObject<ComposerInputRef>
              }
              manageButtonPlacement="after-leading"
              managePanelAlign="left"
              leadingContent={
                <>
                  {browserElementRowContent}
                  {leadingActionSlot}
                  {cliLaunchModeSwitch}
                  {cliLaunchModeSwitch && (
                    <div
                      aria-hidden
                      className="mx-1 h-4 w-px shrink-0 bg-border-2"
                    />
                  )}
                  <WorkItemAttachmentControl
                    currentWorkItemContext={attachedWorkItemContext}
                    panelHostRef={workItemPanelHostRef}
                    repoPath={currentRepoPath}
                    onWorkItemContextChange={setAttachedWorkItemContext}
                  />
                  {selectedOrg && (
                    <Button
                      variant="secondary"
                      appearance="outline"
                      size="small"
                      shape="round"
                      icon={<Network size={14} strokeWidth={1.75} />}
                      title={t("creator.orgMembers.configButton")}
                      aria-label={t("creator.orgMembers.configButton")}
                      aria-expanded={isOrgMembersPanelOpen}
                      aria-controls="session-creator-org-members-panel"
                      onClick={handleToggleOrgMembers}
                      className={
                        isOrgMembersPanelOpen
                          ? "shrink-0 !bg-fill-1 !text-primary-6"
                          : "shrink-0"
                      }
                      data-testid="session-creator-org-members-toggle"
                    >
                      {t("creator.orgMembers.configButton")}
                    </Button>
                  )}
                </>
              }
            />
          </div>

          <div
            ref={workItemPanelHostRef}
            className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
          />

          {selectedOrg && isOrgMembersPanelOpen && (
            <div id="session-creator-org-members-panel">
              <SessionCreatorOrgMembersPanel
                org={selectedOrg}
                advancedConfig={advancedConfig}
                onAdvancedConfigChange={handleAdvancedConfigChange}
                allAgents={allAgentDefinitions}
                cliAgents={enabledCliAgentList}
              />
            </div>
          )}

          {!hidePresenceButton && (
            <div className="flex w-full items-center justify-center gap-2 pt-1">
              <PresenceMenuButton
                variant="detailed"
                dropdownPosition="bottom-start"
              />
            </div>
          )}

          {footerSlot}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="chat-file-upload-input"
        onChange={handleFileUpload}
        accept="*/*"
      />

      {modelPickerStyle === "dropdown" ? (
        <DispatchCategoryDropdown
          isOpen={isCategorySelectorOpen}
          onClose={() => setIsCategorySelectorOpen(false)}
          onSelect={handleAgentPickerSelect}
          currentCategory={dispatchCategory}
          currentAgentDefinitionId={selectedAgentDefId ?? undefined}
          currentAgentOrgId={selectedAgentOrgId ?? undefined}
          currentCliAgentType={cliAgentType ?? undefined}
          anchorRef={agentHeroRef}
        />
      ) : (
        <DispatchCategoryPalette
          isOpen={isCategorySelectorOpen}
          onClose={() => setIsCategorySelectorOpen(false)}
          onSelect={handleAgentPickerSelect}
          currentCategory={dispatchCategory}
          currentAgentDefinitionId={selectedAgentDefId ?? undefined}
          currentAgentOrgId={selectedAgentOrgId ?? undefined}
          currentCliAgentType={cliAgentType ?? undefined}
        />
      )}

      {screenPickerMonitors && (
        <ScreenPickerModal
          monitors={screenPickerMonitors}
          onSelect={handleScreenPicked}
          onClose={() => setScreenPickerMonitors(null)}
        />
      )}
    </div>
  );
};

SessionCreatorChatPanelSingle.displayName = "SessionCreatorChatPanelSingle";

export default SessionCreatorChatPanelSingle;
