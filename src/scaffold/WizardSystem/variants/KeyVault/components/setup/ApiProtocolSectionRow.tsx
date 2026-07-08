import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ProviderProtocol } from "@src/api/tauri/rpc/schemas/validation";
import type { ModelType } from "@src/api/types/keys";
import Select from "@src/components/Select";
import {
  SECTION_CONTROL_STYLE,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

import { getOfficialBaseUrlForProtocol } from "./providerProtocolUrls";
import type { AgentSetupProps } from "./types";

type BaseUrlMode = "official" | "custom";

interface ApiProtocolSectionRowProps {
  agentType: ModelType;
  selectedProtocol: ProviderProtocol;
  supportedProtocols: readonly ProviderProtocol[];
  defaultBaseUrl?: string | null;
  baseUrlMode: BaseUrlMode;
  extractedBaseUrl?: string;
  onChange: AgentSetupProps["onChange"];
}

export function ApiProtocolSectionRow({
  agentType,
  selectedProtocol,
  supportedProtocols,
  defaultBaseUrl,
  baseUrlMode,
  extractedBaseUrl,
  onChange,
}: ApiProtocolSectionRowProps) {
  const { t } = useTranslation("integrations");

  const protocolOptions = useMemo(
    () =>
      supportedProtocols.map((protocol) => ({
        value: protocol,
        label: protocol === "anthropic" ? "Anthropic" : "OpenAI",
      })),
    [supportedProtocols]
  );

  const handleProtocolChange = (protocol: string | number) => {
    const nextProtocol = protocol as ProviderProtocol;
    const nextOfficialBaseUrl = getOfficialBaseUrlForProtocol(
      agentType,
      nextProtocol,
      defaultBaseUrl
    );
    onChange({
      protocol: nextProtocol,
      extracted_base_url:
        baseUrlMode === "official"
          ? nextOfficialBaseUrl || undefined
          : extractedBaseUrl,
      validated: false,
      available_models: [],
      model_context_lengths: {},
      enabled_models: [],
    });
  };

  return (
    <SectionRow
      label={t("keyVault.apiProtocolLabel")}
      description={t("keyVault.apiProtocolDesc")}
    >
      <Select
        value={selectedProtocol}
        onChange={handleProtocolChange}
        options={protocolOptions}
        size="default"
        style={SECTION_CONTROL_STYLE}
      />
    </SectionRow>
  );
}
