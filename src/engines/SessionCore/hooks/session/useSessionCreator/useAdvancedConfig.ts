import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import {
  CLI_AGENT,
  type CliAgentType,
  type ModelType,
  NATIVE_HARNESS_TYPE,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE, isHostedKey } from "@src/api/tauri/session";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import { type KeyVaultAccount, useKeyVault } from "@src/hooks/keyVault";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import {
  creatorDefaultModelSelectionAtom,
  extractModelPair,
} from "@src/store/session/creatorDefaultModelAtom";
import {
  cliAgentTypeAtom,
  dispatchCategoryAtom,
  remoteTargetAtom,
  selectedAgentOrgIdAtom,
} from "@src/store/session/creatorStateAtom";

type AgentOrgMemberDraftConfig = Pick<
  AdvancedConfig,
  "agentOrgMemberOverrides" | "applyAgentOrgMemberOverridesForFuture"
>;

export const agentOrgMemberDraftConfigByOrgAtom = atom<
  Record<string, AgentOrgMemberDraftConfig>
>({});

export const agentOrgMemberDraftConfigAtom = atom(
  (get): AgentOrgMemberDraftConfig => {
    const orgId = get(selectedAgentOrgIdAtom);
    if (!orgId) return {};
    return get(agentOrgMemberDraftConfigByOrgAtom)[orgId] ?? {};
  },
  (get, set, next: AgentOrgMemberDraftConfig) => {
    const orgId = get(selectedAgentOrgIdAtom);
    if (!orgId) return;
    const currentByOrg = get(agentOrgMemberDraftConfigByOrgAtom);
    set(agentOrgMemberDraftConfigByOrgAtom, {
      ...currentByOrg,
      [orgId]: next,
    });
  }
);

interface UseAdvancedConfigResult {
  advancedConfig: AdvancedConfig;
  setAdvancedConfig: (
    nextOrUpdater: AdvancedConfig | ((prev: AdvancedConfig) => AdvancedConfig)
  ) => void;
  setLastModelSelection: ReturnType<
    typeof useSetAtom<typeof creatorDefaultModelSelectionAtom>
  >;
}

/**
 * Derives AdvancedConfig from the canonical model selection atom.
 * Provides a stable setter that extracts only the model pair for storage.
 */
export function useAdvancedConfig(): UseAdvancedConfigResult {
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const atomCliAgentType = useAtomValue(cliAgentTypeAtom);
  const atomRemoteTarget = useAtomValue(remoteTargetAtom);
  const setRemoteTarget = useSetAtom(remoteTargetAtom);
  const { getAccount } = useKeyVault({ autoLoad: true });

  const lastModelSelection = useValidatedLastPair();
  const memberDraftConfig = useAtomValue(agentOrgMemberDraftConfigAtom);
  const setMemberDraftConfig = useSetAtom(agentOrgMemberDraftConfigAtom);
  const setLastModelSelection = useSetAtom(creatorDefaultModelSelectionAtom);

  const baseAdvancedConfig = useMemo<AdvancedConfig>(() => {
    if (!lastModelSelection) {
      return atomCliAgentType
        ? {
            cliAgentType: atomCliAgentType as CliAgentType,
            ...memberDraftConfig,
          }
        : { ...memberDraftConfig };
    }

    if (isHostedKey(lastModelSelection.keySource)) {
      return {
        keySource: KEY_SOURCE.HOSTED,
        cliAgentType:
          lastModelSelection.cliAgentType ?? atomCliAgentType ?? undefined,
        tier: lastModelSelection.tier,
        listingModel: lastModelSelection.listingModel,
        listingModelDisplay: lastModelSelection.listingModelDisplay,
        listingModelType: lastModelSelection.listingModelType,
        listingName: lastModelSelection.listingName,
        selectedSourceLabel: lastModelSelection.selectedSourceLabel,
        selectedSourceModelType: lastModelSelection.selectedSourceModelType,
        ...memberDraftConfig,
      };
    }

    const selectedAccount: KeyVaultAccount | undefined =
      lastModelSelection.selectedAccountId
        ? getAccount(lastModelSelection.selectedAccountId)
        : undefined;
    const selectedSourceModelType = lastModelSelection.selectedSourceModelType;
    const nativeHarnessType =
      dispatchCategory === "rust_agent" &&
      (selectedAccount?.nativeHarnessType ||
        selectedSourceModelType === CLI_AGENT.CURSOR)
        ? (selectedAccount?.nativeHarnessType ?? NATIVE_HARNESS_TYPE.CURSOR)
        : undefined;

    return {
      keySource: KEY_SOURCE.OWN,
      cliAgentType: atomCliAgentType ?? undefined,
      provider: lastModelSelection.provider,
      model: lastModelSelection.model,
      nativeHarnessType,
      agent: lastModelSelection.provider as ModelType | undefined,
      selectedAccountId: lastModelSelection.selectedAccountId,
      selectedSourceLabel: lastModelSelection.selectedSourceLabel,
      selectedSourceModelType,
      ...memberDraftConfig,
    };
  }, [
    lastModelSelection,
    atomCliAgentType,
    dispatchCategory,
    getAccount,
    memberDraftConfig,
  ]);

  // `remoteTarget` is backed by its own atom (it's not part of the model-pair
  // selection). Spread it on top of the derived config so the SSH-host input
  // in SessionCreator is editable — without this, the memo above (rebuilt
  // from model-pair atoms) would drop remoteTarget on every keystroke and the
  // input would appear frozen.
  const advancedConfig = useMemo<AdvancedConfig>(
    () => ({ ...baseAdvancedConfig, remoteTarget: atomRemoteTarget }),
    [baseAdvancedConfig, atomRemoteTarget]
  );

  const setAdvancedConfig = useCallback(
    (
      nextOrUpdater: AdvancedConfig | ((prev: AdvancedConfig) => AdvancedConfig)
    ) => {
      const resolved =
        typeof nextOrUpdater === "function"
          ? nextOrUpdater(advancedConfig)
          : nextOrUpdater;
      setMemberDraftConfig({
        agentOrgMemberOverrides: resolved.agentOrgMemberOverrides,
        applyAgentOrgMemberOverridesForFuture:
          resolved.applyAgentOrgMemberOverridesForFuture,
      });
      const pair = extractModelPair(resolved);
      setLastModelSelection(pair);
      setRemoteTarget(resolved.remoteTarget);
    },
    [
      advancedConfig,
      setLastModelSelection,
      setMemberDraftConfig,
      setRemoteTarget,
    ]
  );

  return { advancedConfig, setAdvancedConfig, setLastModelSelection };
}
