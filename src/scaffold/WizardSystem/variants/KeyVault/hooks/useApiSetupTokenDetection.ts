import type { TFunction } from "i18next";
import { type MutableRefObject, useCallback } from "react";

import {
  autoDetectKey,
  getCodexOAuthModels as fetchCodexOAuthModels,
  getOAuthModelCatalog,
} from "@src/api/services/keyValidation";
import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validation";
import type { DetectedKey } from "@src/api/types/keys";
import { createLogger } from "@src/hooks/logger";

import type { WizardData } from "../types";
import { applyKey } from "./keyHelpers";

const log = createLogger("ApiSetup");

interface UseApiSetupTokenDetectionOptions {
  data: WizardData;
  onChange: (updates: Partial<WizardData>) => void;
  t: TFunction<"integrations">;
  isCursor: boolean;
  isOAuthAgent: boolean;
  isClaudeCode: boolean;
  isCodex: boolean;
  agentModelsRef: MutableRefObject<string[]>;
  detectedKeys: DetectedKey[];
  selectedCredentialIndex: number;
  setDetectingToken: (value: boolean) => void;
  setTokenDetected: (value: boolean) => void;
  setTokenError: (value: string | null) => void;
  setCursorSessionToken: (value: string) => void;
  setShowKeySelection: (value: boolean) => void;
  setDetectedKeys: (value: DetectedKey[]) => void;
  setSelectedCredentialIndex: (value: number) => void;
}

export function useApiSetupTokenDetection({
  data,
  onChange,
  t,
  isCursor,
  isOAuthAgent,
  isClaudeCode,
  isCodex,
  agentModelsRef,
  detectedKeys,
  selectedCredentialIndex,
  setDetectingToken,
  setTokenDetected,
  setTokenError,
  setCursorSessionToken,
  setShowKeySelection,
  setDetectedKeys,
  setSelectedCredentialIndex,
}: UseApiSetupTokenDetectionOptions) {
  const applySelectedKey = useCallback(
    async (cred: DetectedKey) => {
      const catalog = isClaudeCode
        ? await getOAuthModelCatalog(CLI_AGENT.CLAUDE_CODE)
        : isCodex
          ? await getOAuthModelCatalog(CLI_AGENT.CODEX)
          : { models: [], defaultEnabledModels: [] };
      let fallbackModels =
        isCodex && agentModelsRef.current.length > 0
          ? agentModelsRef.current
          : catalog.models;
      if (isCodex && cred.session_token) {
        const idToken = cred.env_vars?.OPENAI_ID_TOKEN;
        try {
          const discovered = await fetchCodexOAuthModels(
            cred.session_token,
            idToken
          );
          if (discovered.length > 0) fallbackModels = discovered;
        } catch (err) {
          log.warn(
            "[ApiSetup] Codex OAuth model discovery failed during auto-detect; using fallback models:",
            err
          );
        }
      }
      const defaultEnabledModels = catalog.defaultEnabledModels.filter(
        (modelId) => fallbackModels.includes(modelId)
      );
      applyKey(cred, {
        onChange,
        setTokenDetected,
        setCursorSessionToken,
        setTokenError,
        setShowKeySelection,
        isCursor,
        isOAuthAgent,
        fallbackModels,
        defaultEnabledModels:
          isClaudeCode || isCodex
            ? defaultEnabledModels.length > 0
              ? defaultEnabledModels
              : fallbackModels.slice(0, 1)
            : undefined,
        noValidTokenMsg: t("keyVault.noValidTokenFound"),
        validationFailedMsg: t("keyVault.quickActions.keyValidationFailed"),
      });
    },
    [
      agentModelsRef,
      isClaudeCode,
      isCodex,
      isOAuthAgent,
      isCursor,
      onChange,
      setCursorSessionToken,
      setShowKeySelection,
      setTokenDetected,
      setTokenError,
      t,
    ]
  );

  const handleAutoDetectToken = useCallback(async () => {
    setDetectingToken(true);
    setTokenError(null);
    setTokenDetected(false);

    try {
      const result = await autoDetectKey(data.agent_type);

      if (!result.success) {
        setTokenError(result.message || t("keyVault.couldNotDetectKeys"));
        return;
      }

      const keys = result.keys || [];

      if (keys.length === 0) {
        setTokenError(t("keyVault.couldNotDetectKeys"));
        return;
      }

      if (keys.length > 1) {
        setDetectedKeys(keys);
        const validOAuthIndex = keys.findIndex(
          (cred) => cred.auth_method === "oauth" && cred.validated
        );
        const validApiKeyIndex = keys.findIndex(
          (cred) => cred.auth_method === "api_key" && cred.validated
        );
        const firstValidIndex = keys.findIndex((cred) => cred.validated);
        setSelectedCredentialIndex(
          isClaudeCode && validOAuthIndex >= 0
            ? validOAuthIndex
            : validApiKeyIndex >= 0
              ? validApiKeyIndex
              : firstValidIndex >= 0
                ? firstValidIndex
                : 0
        );
        setShowKeySelection(true);
        return;
      }

      applySelectedKey(keys[0]);
    } catch (err) {
      log.error("[ApiSetup] Failed to auto-detect credentials:", err);
      setTokenError(t("keyVault.failedToDetectKeys"));
    } finally {
      setDetectingToken(false);
    }
  }, [
    data.agent_type,
    applySelectedKey,
    isClaudeCode,
    setDetectedKeys,
    setDetectingToken,
    setSelectedCredentialIndex,
    setShowKeySelection,
    setTokenDetected,
    setTokenError,
    t,
  ]);

  const handleConfirmKeySelection = useCallback(() => {
    const selected = detectedKeys[selectedCredentialIndex];
    if (selected) {
      applySelectedKey(selected);
    }
  }, [detectedKeys, selectedCredentialIndex, applySelectedKey]);

  return { handleAutoDetectToken, handleConfirmKeySelection };
}
