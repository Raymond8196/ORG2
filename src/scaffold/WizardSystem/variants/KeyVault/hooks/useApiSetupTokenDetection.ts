import type { TFunction } from "i18next";
import { type MutableRefObject, useCallback } from "react";

import {
  autoDetectKey,
  getCodexOAuthModels as fetchCodexOAuthModels,
  validateKey,
} from "@src/api/services/keyValidation";
import type { DetectedKey } from "@src/api/types/keys";
import { createLogger } from "@src/hooks/logger";
import {
  getClaudeCodeOAuthDefaultEnabledModels,
  getClaudeCodeOAuthModels,
  getCodexOAuthDefaultEnabledModels,
  getCodexOAuthModels,
} from "@src/hooks/models/nativeHarnessAccountModels";

import type { WizardData } from "../types";
import { applyKey } from "./keyHelpers";

const log = createLogger("ApiSetup");

const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

function selectedOpenCodeBaseUrl(baseUrl?: string): string {
  return baseUrl === OPENCODE_GO_BASE_URL
    ? OPENCODE_GO_BASE_URL
    : OPENCODE_ZEN_BASE_URL;
}

function canUseDetectedOpenCodeKeyForEndpoint(
  key: DetectedKey,
  baseUrl: string
): boolean {
  if (baseUrl === OPENCODE_ZEN_BASE_URL) {
    return key.base_url === OPENCODE_ZEN_BASE_URL;
  }
  return (
    key.base_url === OPENCODE_GO_BASE_URL ||
    key.base_url === OPENCODE_ZEN_BASE_URL
  );
}

async function validateDetectedOpenCodeKeyForEndpoint(
  key: DetectedKey,
  baseUrl: string
): Promise<DetectedKey> {
  if (!key.api_key) return key;
  const validation = await validateKey("opencode", key.api_key, baseUrl);
  return {
    ...key,
    base_url: baseUrl,
    validated: validation.valid,
    validation_message: validation.message,
    available_models: validation.models_available ?? [],
  };
}

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
      if (data.agent_type === "opencode" && cred.api_key) {
        const models = cred.available_models ?? [];
        applyKey(cred, {
          onChange,
          setTokenDetected,
          setCursorSessionToken,
          setTokenError,
          setShowKeySelection,
          isCursor,
          isOAuthAgent,
          fallbackModels: models,
          noValidTokenMsg: t("keyVault.noValidTokenFound"),
          validationFailedMsg: t("keyVault.quickActions.keyValidationFailed"),
        });
        return;
      }

      let fallbackModels = isClaudeCode
        ? getClaudeCodeOAuthModels()
        : isCodex
          ? agentModelsRef.current.length > 0
            ? agentModelsRef.current
            : getCodexOAuthModels()
          : [];
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
      const codexDefaultEnabledModels =
        getCodexOAuthDefaultEnabledModels().filter((modelId) =>
          fallbackModels.includes(modelId)
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
        defaultEnabledModels: isClaudeCode
          ? getClaudeCodeOAuthDefaultEnabledModels()
          : isCodex
            ? codexDefaultEnabledModels.length > 0
              ? codexDefaultEnabledModels
              : fallbackModels.slice(0, 1)
            : undefined,
        noValidTokenMsg: t("keyVault.noValidTokenFound"),
        validationFailedMsg: t("keyVault.quickActions.keyValidationFailed"),
      });
    },
    [
      data.agent_type,
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
      const candidateKeys =
        data.agent_type === "opencode"
          ? await Promise.all(
              keys
                .filter((key) =>
                  canUseDetectedOpenCodeKeyForEndpoint(
                    key,
                    selectedOpenCodeBaseUrl(data.extracted_base_url)
                  )
                )
                .map((key) =>
                  validateDetectedOpenCodeKeyForEndpoint(
                    key,
                    selectedOpenCodeBaseUrl(data.extracted_base_url)
                  )
                )
            )
          : keys;

      if (candidateKeys.length === 0) {
        setTokenError(t("keyVault.couldNotDetectKeys"));
        return;
      }

      if (candidateKeys.length > 1) {
        setDetectedKeys(candidateKeys);
        const validApiKeyIndex = candidateKeys.findIndex(
          (cred) => cred.auth_method === "api_key" && cred.validated
        );
        const firstValidIndex = candidateKeys.findIndex(
          (cred) => cred.validated
        );
        setSelectedCredentialIndex(
          validApiKeyIndex >= 0
            ? validApiKeyIndex
            : firstValidIndex >= 0
              ? firstValidIndex
              : 0
        );
        setShowKeySelection(true);
        return;
      }

      applySelectedKey(candidateKeys[0]);
    } catch (err) {
      log.error("[ApiSetup] Failed to auto-detect credentials:", err);
      setTokenError(t("keyVault.failedToDetectKeys"));
    } finally {
      setDetectingToken(false);
    }
  }, [
    data.agent_type,
    data.extracted_base_url,
    applySelectedKey,
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
