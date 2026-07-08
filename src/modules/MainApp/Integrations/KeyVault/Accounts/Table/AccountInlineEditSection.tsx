/**
 * AccountInlineEditSection — Inline name/description editor for the
 * AccountInlineExpandedCard "Edit" tab.
 *
 * Replaces the legacy standalone AccountEditForm page. Only name and
 * description are editable here; an InlineAlert directs users to delete and
 * re-add the account if they need to change API keys / credentials.
 *
 * The form body and the Cancel/Save footer are rendered as separate
 * components so the footer sits in the same slot as the other tabs'
 * AccountInlineActionsBar (sibling of InlineCardBody inside
 * InlineCardShell).
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Textarea from "@src/components/Textarea";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import {
  SelectionGrid,
  type SelectionGridOption,
} from "@src/scaffold/WizardSystem/primitives";

import {
  InlineCardColumnStack,
  InlineCardFooter,
} from "../../shared/InlineCardPrimitives";

interface AccountInlineEditState {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  endpoint: OpenCodeEndpoint;
  setEndpoint: (value: OpenCodeEndpoint) => void;
  saving: boolean;
  savedAt: number | null;
  canSave: boolean;
  handleSave: () => Promise<void>;
}

type OpenCodeEndpoint = "zen" | "go";

const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

const OPENCODE_ENDPOINT_OPTIONS: SelectionGridOption<OpenCodeEndpoint>[] = [
  {
    key: "zen",
    label: "OpenCode Zen",
    badge: "Recommended",
    description: "Use Zen subscription models such as Claude Sonnet.",
  },
  {
    key: "go",
    label: "OpenCode Go",
    description: "Use the OpenCode Go endpoint and model list.",
  },
];

function getOpenCodeEndpointFromBaseUrl(
  baseUrl?: string | null
): OpenCodeEndpoint {
  return baseUrl === OPENCODE_GO_BASE_URL ? "go" : "zen";
}

function getOpenCodeBaseUrl(endpoint: OpenCodeEndpoint): string {
  return endpoint === "go" ? OPENCODE_GO_BASE_URL : OPENCODE_ZEN_BASE_URL;
}

function isOpenCodeAccount(account: KeyVaultAccount): boolean {
  return account.modelType === "opencode";
}

/**
 * Owns the edit form state. Pair with {@link AccountInlineEditBody} and
 * {@link AccountInlineEditFooter}.
 */
export function useAccountInlineEditState(
  account: KeyVaultAccount,
  onSave: (name: string, description: string, baseUrl?: string) => Promise<void>
): AccountInlineEditState {
  const [name, setName] = useState(account.name);
  const [description, setDescription] = useState(account.description ?? "");
  const [endpoint, setEndpoint] = useState<OpenCodeEndpoint>(
    getOpenCodeEndpointFromBaseUrl(account.baseUrl)
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setName(account.name);
    setDescription(account.description ?? "");
    setEndpoint(getOpenCodeEndpointFromBaseUrl(account.baseUrl));
  }, [account.id, account.name, account.description, account.baseUrl]);

  const trimmedName = name.trim();
  const isDirty =
    trimmedName !== account.name ||
    description.trim() !== (account.description ?? "").trim() ||
    (isOpenCodeAccount(account) &&
      endpoint !== getOpenCodeEndpointFromBaseUrl(account.baseUrl));
  const canSave = isDirty && trimmedName.length > 0 && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(
        trimmedName,
        description.trim(),
        isOpenCodeAccount(account) ? getOpenCodeBaseUrl(endpoint) : undefined
      );
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }, [account, canSave, description, endpoint, onSave, trimmedName]);

  useEffect(() => {
    if (savedAt == null) return;
    const handle = window.setTimeout(() => setSavedAt(null), 3000);
    return () => window.clearTimeout(handle);
  }, [savedAt]);

  return {
    name,
    setName,
    description,
    setDescription,
    endpoint,
    setEndpoint,
    saving,
    savedAt,
    canSave,
    handleSave,
  };
}

interface AccountInlineEditBodyProps {
  account: KeyVaultAccount;
  state: AccountInlineEditState;
}

export const AccountInlineEditBody: React.FC<AccountInlineEditBodyProps> = ({
  account,
  state,
}) => {
  const { t } = useTranslation("integrations");
  const { name, setName, description, setDescription, endpoint, setEndpoint } =
    state;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <InlineCardColumnStack>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1 text-[12px] font-semibold text-text-1">
            {t("keyVault.accountName")}
            <span className="ml-0.5 text-danger-6">*</span>
          </span>
          <Input
            value={name}
            onChange={setName}
            placeholder={t("keyVault.accountNamePlaceholder")}
            spellCheck={false}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] font-semibold text-text-1">
            {t("keyVault.descriptionOptional")}
          </span>
          <Textarea
            value={description}
            onChange={setDescription}
            placeholder={t("keyVault.descriptionPlaceholder")}
            rows={2}
          />
        </div>
        {isOpenCodeAccount(account) ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[12px] font-semibold text-text-1">
              OpenCode endpoint
            </span>
            <SelectionGrid
              options={OPENCODE_ENDPOINT_OPTIONS}
              selected={endpoint}
              onSelect={setEndpoint}
              columns={2}
              cardVariant="subtle"
              compactCards
            />
          </div>
        ) : null}
      </InlineCardColumnStack>

      <InlineAlert type="info">{t("keyVault.edit.apiChangeHint")}</InlineAlert>
    </div>
  );
};

interface AccountInlineEditFooterProps {
  state: AccountInlineEditState;
  onCancel: () => void;
}

export const AccountInlineEditFooter: React.FC<
  AccountInlineEditFooterProps
> = ({ state, onCancel }) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation();
  const { saving, savedAt, canSave, handleSave } = state;

  return (
    <InlineCardFooter>
      {savedAt != null ? (
        <span className="mr-auto text-[12px] text-success-6">
          {t("keyVault.edit.saved")}
        </span>
      ) : null}
      <Button variant="secondary" size="small" onClick={onCancel}>
        {tCommon("actions.cancel")}
      </Button>
      <Button
        variant="primary"
        size="small"
        onClick={handleSave}
        disabled={!canSave}
        loading={saving}
      >
        {tCommon("actions.save")}
      </Button>
    </InlineCardFooter>
  );
};
