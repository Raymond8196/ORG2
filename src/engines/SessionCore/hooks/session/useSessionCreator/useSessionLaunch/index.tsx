/**
 * useSessionLaunch Hook
 *
 * Validates input, resolves keys, calls the unified launchSession() pipeline,
 * then handles state updates and navigation.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { sessionLaunch } from "@src/api/tauri/agent/session";
import { DISPATCH_CATEGORY, KEY_SOURCE } from "@src/api/tauri/session";
import { Message } from "@src/components/Message";
import { beginOptimisticTurn } from "@src/engines/SessionCore/control/optimisticTurnStatus";
import { markTurnRunning } from "@src/engines/SessionCore/control/turnLifecycle";
import {
  loadSessionAtom,
  pendingSyntheticEventAtom,
} from "@src/engines/SessionCore/core/atoms";
import { SESSION_CREATOR_LAUNCH_MODE } from "@src/features/SessionCreator/types";
import { createLogger } from "@src/hooks/logger";
import { collectAdeContext } from "@src/services/context/collectors";
import {
  activeSessionIdAtom,
  dispatchCategoryAtom,
  loadSidebarSessions,
  selectedAgentDefinitionIdAtom,
  selectedAgentOrgIdAtom,
  sessionCreatorDraftAtom,
  sessionSourceAtom,
  sessionTargetKindAtom,
  upsertSession,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { lastUserMessageAtom } from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import { cursorCreatorModeOverrideAtom } from "@src/store/session/cursorModeOverrideAtom";
import { cursorCreatorModelOverrideAtom } from "@src/store/session/cursorModelOverrideAtom";
import { runningLocationAtom } from "@src/store/session/runningLocationAtom";
import { selectedWorktreePathAtom } from "@src/store/session/selectedWorktreePathAtom";
import { worktreeLaunchSourceAtom } from "@src/store/session/worktreeLaunchSourceAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { triggerSessionExpired } from "@src/store/ui/uiAtom";
import type { ViewModeType } from "@src/store/ui/viewModeAtom";
import {
  viewModeAtom,
  viewModeSwitchingAtom,
} from "@src/store/ui/viewModeAtom";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import { emitOpenWorkspace } from "@src/util/ui/window/windowManager";

import {
  buildCursorComposerParams,
  buildCursorIdeSession,
  openCursorComposerWithRetry,
} from "./cursorIdeLaunch";
import { formatAgentLaunchError } from "./errorUtils";
import { prepareLaunchInput } from "./inputPreparation";
import { handleNonCursorLaunchError } from "./launchErrorHandling";
import { handleSessionNavigation } from "./launchHelpers";
import { isBackgroundLaunchMode } from "./launchMode";
import {
  buildSessionFromLaunchResult,
  buildSessionLaunchPayload,
} from "./launchPayload";
import {
  confirmShortInputIfNeeded,
  showValidationErrors,
} from "./launchValidation";
import { resolveKeys } from "./resolveKeys";
import { injectSyntheticUserEventIfNeeded } from "./syntheticEvents";
import type {
  SessionLaunchDebugState,
  UseSessionLaunchOptions,
  UseSessionLaunchReturn,
} from "./types";
import { useWalletModalState } from "./walletModalState";

export type { UseSessionLaunchOptions, UseSessionLaunchReturn } from "./types";

const log = createLogger("useSessionLaunch");
const LAUNCH_DEBUG_STORAGE_KEY = "orgii:sshRemoteLaunchDebug";

function persistLaunchDebug(state: SessionLaunchDebugState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LAUNCH_DEBUG_STORAGE_KEY,
      JSON.stringify(state)
    );
  } catch {
    // Debug-only persistence; keep launch behavior unchanged if storage fails.
  }
}

export function useSessionLaunch(
  options: UseSessionLaunchOptions
): UseSessionLaunchReturn {
  const {
    effectiveSource,
    editorContent,
    sessionName,
    advancedConfig,
    isContentEmpty,
    validateSessionConfig,
    composerInputRef,
    onLaunchSuccess,
    launchMode = SESSION_CREATOR_LAUNCH_MODE.START_FOREGROUND,
    workItemContext,
    resolveWorkItemContext,
    imageDataUrls,
    clearImages,
  } = options;

  const { t } = useTranslation("sessions");
  const [isLoading, setIsLoading] = useState(false);
  const [debugState, setDebugState] = useState<SessionLaunchDebugState | null>(
    null
  );
  const setLaunchDebug = useCallback(
    (stage: string, message: string, details?: Record<string, unknown>) => {
      const next = { stage, message, timestamp: Date.now(), details };
      setDebugState(next);
      persistLaunchDebug(next);
      log.info("[launch-debug]", next);
    },
    []
  );
  const {
    closeAddFundsModal,
    closeBuyCreditsModal,
    setShowAddFundsModal,
    setShowBuyCreditsModal,
    showAddFundsModal,
    showBuyCreditsModal,
  } = useWalletModalState();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const targetKind = useAtomValue(sessionTargetKindAtom);
  const selectedAgentDefId = useAtomValue(selectedAgentDefinitionIdAtom);
  const selectedAgentOrgId = useAtomValue(selectedAgentOrgIdAtom);
  const agentExecMode = useAtomValue(creatorDefaultExecModeAtom);
  const runningLocation = useAtomValue(runningLocationAtom);
  const selectedWorktreePath = useAtomValue(selectedWorktreePathAtom);
  const worktreeLaunchSource = useAtomValue(worktreeLaunchSourceAtom);
  const cursorCreatorModelOverride = useAtomValue(
    cursorCreatorModelOverrideAtom
  );
  const setCursorCreatorModelOverride = useSetAtom(
    cursorCreatorModelOverrideAtom
  );
  const cursorCreatorModeOverride = useAtomValue(cursorCreatorModeOverrideAtom);
  const setCursorCreatorModeOverride = useSetAtom(
    cursorCreatorModeOverrideAtom
  );
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const setViewMode = useSetAtom(viewModeAtom);
  const setIsSwitching = useSetAtom(viewModeSwitchingAtom);
  const clearDraft = useSetAtom(sessionCreatorDraftAtom);
  const dispatchLoadSession = useSetAtom(loadSessionAtom);
  const setPendingSyntheticEvent = useSetAtom(pendingSyntheticEventAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setWorkstationActiveSessionId = useSetAtom(
    workstationActiveSessionIdAtom
  );
  const setStationMode = useSetAtom(stationModeAtom);
  const setLastUserMessage = useSetAtom(lastUserMessageAtom);
  const setSessionSource = useSetAtom(sessionSourceAtom);
  const showAuthError = useCallback(() => {
    triggerSessionExpired();
  }, []);

  const navigateToLaunchedSession = useCallback(
    (sessionId: string, forceNavigate: boolean) => {
      handleSessionNavigation({
        sessionId,
        locationPathname: location.pathname,
        navigate,
        setActiveSessionId,
        setWorkstationActiveSessionId,
        setViewMode: (viewMode: ViewModeType) => setViewMode(viewMode),
        setIsSwitching,
        clearDraft,
        setStationMode,
        forceNavigate,
        onLaunchSuccess,
      });
    },
    [
      clearDraft,
      location.pathname,
      navigate,
      onLaunchSuccess,
      setActiveSessionId,
      setIsSwitching,
      setStationMode,
      setViewMode,
      setWorkstationActiveSessionId,
    ]
  );

  const executeCursorIdeLaunch = useCallback(
    async (
      agentInput: string,
      userInput: string,
      isBackgroundLaunch: boolean,
      launchWorkItemContext?: typeof workItemContext
    ) => {
      const result = await openCursorComposerWithRetry(
        buildCursorComposerParams({
          text: agentInput,
          cursorCreatorModelOverride,
          cursorCreatorModeOverride,
        })
      );
      const session = buildCursorIdeSession({
        composerId: result.composerId,
        isBackgroundLaunch,
        sessionName,
        userInput,
      });
      upsertSession(session);

      injectSyntheticUserEventIfNeeded({
        dispatchLoadSession,
        hasImages: false,
        imageDataUrls: undefined,
        isBackgroundLaunch,
        isContentEmpty,
        sessionId: session.session_id,
        setLastUserMessage,
        setPendingSyntheticEvent,
        userInput,
      });

      if (imageDataUrls && imageDataUrls.length > 0) {
        clearImages?.();
      }

      if (isBackgroundLaunch) {
        clearDraft(null);
        onLaunchSuccess?.({
          sessionId: session.session_id,
          workItemContext: launchWorkItemContext,
        });
      } else {
        navigateToLaunchedSession(session.session_id, false);
      }
      setSessionSource(null);
      setCursorCreatorModelOverride(null);
      setCursorCreatorModeOverride(null);
    },
    [
      clearDraft,
      clearImages,
      cursorCreatorModeOverride,
      cursorCreatorModelOverride,
      dispatchLoadSession,
      imageDataUrls,
      isContentEmpty,
      navigateToLaunchedSession,
      onLaunchSuccess,
      sessionName,
      setCursorCreatorModeOverride,
      setCursorCreatorModelOverride,
      setLastUserMessage,
      setPendingSyntheticEvent,
      setSessionSource,
    ]
  );

  const handleLaunch = useCallback(async () => {
    const remoteTarget = advancedConfig.remoteTarget;
    const remoteHost = remoteTarget?.host.trim() ?? "";
    const remoteWorkingDir = remoteTarget?.workingDir?.trim() ?? "";
    setLaunchDebug("clicked", "Launch handler invoked", {
      dispatchCategory,
      targetKind,
      keySource: advancedConfig.keySource ?? KEY_SOURCE.OWN,
      cliAgentType: advancedConfig.cliAgentType ?? null,
      effectiveRepoId: effectiveSource?.repoId ?? null,
      effectiveRepoPath: effectiveSource?.repoPath ?? null,
      remoteHost: remoteHost || null,
      remoteWorkingDir: remoteWorkingDir || null,
      isContentEmpty,
      isLoading,
    });

    if (isLoading) {
      setLaunchDebug("ignored_loading", "Launch ignored because one is active");
      return false;
    }

    setLaunchDebug("validation", "Validating launch configuration");
    const validation = validateSessionConfig();
    if (!validation.valid) {
      setLaunchDebug("validation_failed", validation.errors.join("; "), {
        errors: validation.errors,
      });
      showValidationErrors(validation);
      return false;
    }

    setLaunchDebug("confirm_input", "Checking launch input");
    const confirmedShortInput = await confirmShortInputIfNeeded(
      editorContent,
      t
    );
    if (!confirmedShortInput) {
      setLaunchDebug("cancelled_input", "Launch cancelled by input check");
      return false;
    }

    setLaunchDebug("prepare_input", "Preparing launch input");
    const { agentInput, userInput } = await prepareLaunchInput({
      editorContent,
      effectiveSource,
      composerInputRef,
    });

    const isBackgroundLaunch = isBackgroundLaunchMode(launchMode);

    if (dispatchCategory === DISPATCH_CATEGORY.CURSOR_IDE) {
      setIsLoading(true);
      try {
        setLaunchDebug("cursor_ide_launch", "Launching Cursor IDE session");
        const resolvedWorkItemContext = resolveWorkItemContext
          ? await resolveWorkItemContext()
          : workItemContext;
        if (resolveWorkItemContext && !resolvedWorkItemContext) {
          setLaunchDebug(
            "work_item_context_missing",
            "Work item context resolver returned nothing"
          );
          return false;
        }

        await executeCursorIdeLaunch(
          agentInput,
          userInput,
          isBackgroundLaunch,
          resolvedWorkItemContext ?? undefined
        );
        return true;
      } catch (error) {
        log.error("Error creating Cursor IDE session:", error);
        Message.error(
          formatAgentLaunchError(
            error instanceof Error
              ? error.message
              : "An unexpected error occurred"
          )
        );
        return false;
      } finally {
        setIsLoading(false);
      }
    }

    setIsLoading(true);

    try {
      const keySource = advancedConfig.keySource ?? KEY_SOURCE.OWN;
      setLaunchDebug("resolve_keys", "Resolving launch key source", {
        keySource,
        cliAgentType: advancedConfig.cliAgentType ?? null,
      });
      const resolvedKeys = await resolveKeys(keySource, advancedConfig, {
        onAuthError: () => {
          clearDraft(null);
          showAuthError();
        },
      });

      if (!resolvedKeys) {
        setLaunchDebug("resolve_keys_failed", "No launch keys were resolved");
        return false;
      }

      setLaunchDebug("work_item_context", "Resolving work item context");
      const resolvedWorkItemContext = resolveWorkItemContext
        ? await resolveWorkItemContext()
        : workItemContext;
      if (resolveWorkItemContext && !resolvedWorkItemContext) {
        setLaunchDebug(
          "work_item_context_missing",
          "Work item context resolver returned nothing"
        );
        return false;
      }

      const adeContext = collectAdeContext({
        expectedRepoPath: effectiveSource?.repoPath || null,
      });
      setLaunchDebug("build_payload", "Building session launch payload");
      const { hasImages, launchParams, sessionUsesHostedKey } =
        buildSessionLaunchPayload({
          agentExecMode,
          agentInput,
          advancedConfig,
          dispatchCategory,
          effectiveSource,
          adeContext,
          imageDataUrls,
          isBackgroundLaunch,
          resolvedKeys,
          runningLocation,
          selectedAgentDefId,
          selectedAgentOrgId,
          selectedWorktreePath,
          sessionName,
          targetKind,
          workspaceFolders,
          worktreeLaunchSource,
        });

      setLaunchDebug("payload_built", "Built session launch payload", {
        category: launchParams.category,
        platform: launchParams.platform ?? null,
        workspacePath: launchParams.workspacePath ?? null,
        execTarget: launchParams.execTarget ?? "local",
        hasImages,
        sessionUsesHostedKey,
      });

      setLaunchDebug("session_launch_rpc", "Calling sessionLaunch RPC", {
        workspacePath: launchParams.workspacePath ?? null,
        execTarget: launchParams.execTarget ?? "local",
      });
      const result = await sessionLaunch({
        ...launchParams,
        ...(resolvedWorkItemContext
          ? {
              orgId: resolvedWorkItemContext.orgId,
              projectId: resolvedWorkItemContext.projectId,
              projectName: resolvedWorkItemContext.projectName,
              ...(resolvedWorkItemContext.workItemId
                ? { workItemId: resolvedWorkItemContext.workItemId }
                : {}),
              agentRole: resolvedWorkItemContext.agentRole,
              projectSlug: resolvedWorkItemContext.projectSlug,
            }
          : {}),
      });
      setLaunchDebug("session_launch_result", "sessionLaunch returned", {
        sessionId: result.sessionId,
        status: result.status,
        workspacePath: result.workspacePath ?? null,
        cliAgentType: result.cliAgentType ?? null,
      });

      if (imageDataUrls && imageDataUrls.length > 0) {
        clearImages?.();
      }

      upsertSession(
        buildSessionFromLaunchResult({
          agentExecMode,
          effectiveSource,
          isBackgroundLaunch,
          launchCliAgentType: launchParams.platform,
          launchExecTarget: launchParams.execTarget,
          launchOrgContext: resolvedWorkItemContext ?? undefined,
          result,
        })
      );
      if (selectedAgentOrgId) {
        void loadSidebarSessions({ forceRefresh: true }).catch(
          (error: unknown) => {
            log.warn(
              "Failed to refresh sidebar after Agent Team launch",
              error
            );
          }
        );
      }

      injectSyntheticUserEventIfNeeded({
        dispatchLoadSession,
        hasImages,
        imageDataUrls,
        isBackgroundLaunch,
        isContentEmpty,
        sessionId: result.sessionId,
        setLastUserMessage,
        setPendingSyntheticEvent,
        userInput,
      });

      // The launch dispatched this session's first turn — open it in the
      // turn-lifecycle FSM so follow-up submits queue until the provider
      // delivers the turn's terminal.
      markTurnRunning(result.sessionId);

      if (isBackgroundLaunch) {
        clearDraft(null);
        onLaunchSuccess?.({
          sessionId: result.sessionId,
          workItemContext: resolvedWorkItemContext ?? undefined,
        });
      } else {
        if (
          dispatchCategory === DISPATCH_CATEGORY.CLI_AGENT &&
          !sessionUsesHostedKey
        ) {
          void emitOpenWorkspace(
            result.sessionId,
            effectiveSource?.repoId ?? "",
            "Quick"
          );
        }
        navigateToLaunchedSession(result.sessionId, sessionUsesHostedKey);
        // After navigation: the pipeline atom now points at the launched
        // session, so the session-gated status write is accepted and the
        // planning indicator covers the gap until Rust's first status event.
        // `beginOptimisticTurn` (not a raw status write) also records a
        // session-scoped "recently started" marker so the session-switch
        // effect that `setActiveSessionId` just scheduled does NOT reset this
        // session's running back to idle — that reset used to erase the
        // launch's running and leave slow providers (deepseek) showing no
        // footer / no Stop until the first stream event arrived seconds later.
        beginOptimisticTurn(result.sessionId, "launch");
      }

      setSessionSource(null);
      setLaunchDebug("complete", "Launch flow completed", {
        sessionId: result.sessionId,
      });
      return true;
    } catch (error) {
      setLaunchDebug("error", "Launch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      log.error("Error creating session:", error);
      handleNonCursorLaunchError({
        advancedConfig,
        clearDraft,
        error,
        setShowAddFundsModal,
        setShowBuyCreditsModal,
        showAuthError,
        t,
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [
    isLoading,
    validateSessionConfig,
    editorContent,
    t,
    effectiveSource,
    composerInputRef,
    launchMode,
    dispatchCategory,
    executeCursorIdeLaunch,
    advancedConfig,
    clearDraft,
    showAuthError,
    agentExecMode,
    imageDataUrls,
    isContentEmpty,
    runningLocation,
    selectedAgentDefId,
    selectedAgentOrgId,
    selectedWorktreePath,
    sessionName,
    targetKind,
    workspaceFolders,
    worktreeLaunchSource,
    setLaunchDebug,
    clearImages,
    dispatchLoadSession,
    setLastUserMessage,
    setPendingSyntheticEvent,
    onLaunchSuccess,
    workItemContext,
    resolveWorkItemContext,
    navigateToLaunchedSession,
    setSessionSource,
    setShowAddFundsModal,
    setShowBuyCreditsModal,
  ]);

  return {
    isLoading,
    debugState,
    handleLaunch,
    showAddFundsModal,
    closeAddFundsModal,
    showBuyCreditsModal,
    closeBuyCreditsModal,
  };
}
