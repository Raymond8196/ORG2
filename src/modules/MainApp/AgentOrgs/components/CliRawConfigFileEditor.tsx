import { FolderOpen } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import type { AvailableAgent } from "@src/api/tauri/rpc/schemas/validation";
import { CodeMirrorEditor } from "@src/features/CodeMirror";
import { PanelFooter } from "@src/modules/shared/layouts/blocks";

type CliConfigFile = AvailableAgent["configFiles"][number];

interface CliRawConfigFileEditorProps {
  agentName: string;
  configFile: CliConfigFile;
  onSaved?: () => void;
}

const FORMAT_EXTENSION: Record<CliConfigFile["format"], string> = {
  json: "json",
  jsonc: "jsonc",
  toml: "toml",
  yaml: "yaml",
  text: "txt",
};

const CliRawConfigFileEditor: React.FC<CliRawConfigFileEditorProps> = ({
  agentName,
  configFile,
  onSaved,
}) => {
  const { t } = useTranslation("integrations");

  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [savedContent, setSavedContent] = useState("");
  const [configPath, setConfigPath] = useState(configFile.path);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const input = { agentName, fileId: configFile.id };
    async function load() {
      const path = await rpc.agentOrgs.cliConfigFiles.getPath(input);
      if (cancelled) return;
      setConfigPath(path);

      const raw = await rpc.agentOrgs.cliConfigFiles.readRaw(input);
      if (cancelled) return;
      setContent(raw);
      setSavedContent(raw);
      setLoading(false);
    }

    load().catch((err: unknown) => {
      if (!cancelled) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agentName, configFile.id]);

  const hasChanges = content !== savedContent;

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setErrorMessage(null);
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setErrorMessage(null);
    try {
      await rpc.agentOrgs.cliConfigFiles.writeRaw({
        agentName,
        fileId: configFile.id,
        content,
      });
      setSavedContent(content);
      setSaveStatus("saved");
      onSaved?.();
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setSaveStatus("error");
    }
  }, [agentName, configFile.id, content, onSaved]);

  const handleReset = useCallback(() => {
    setContent(savedContent);
    setErrorMessage(null);
    setSaveStatus("idle");
  }, [savedContent]);

  const handleRevealConfig = useCallback(() => {
    void rpc.agentOrgs.cliConfigFiles
      .reveal({ agentName, fileId: configFile.id })
      .catch((err: unknown) => {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setSaveStatus("error");
      });
  }, [agentName, configFile.id]);

  if (loading) return null;

  const filePath = `${configFile.id}.${FORMAT_EXTENSION[configFile.format]}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={content}
          onChange={handleChange}
          filePath={filePath}
          height="100%"
        />
      </div>

      <PanelFooter
        left={
          <>
            <div className="text-xs text-text-3">{configPath}</div>
            <div className="flex items-center gap-2 text-xs">
              {configFile.secretBearing && (
                <span className="text-warning-6">
                  {t("agentOrgs.cliAgentDetail.secretBearingConfig")}
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-success-6">
                  {t("common:status.saved", "Saved")}
                </span>
              )}
              {errorMessage && (
                <span className="max-w-[300px] truncate text-danger-6">
                  {errorMessage}
                </span>
              )}
            </div>
          </>
        }
        secondaryActions={[
          {
            label: t("agentOrgs.cliAgentDetail.revealConfigFile"),
            title: t("agentOrgs.cliAgentDetail.revealConfigFile"),
            icon: <FolderOpen size={14} />,
            iconOnly: true,
            onClick: handleRevealConfig,
          },
          ...(hasChanges
            ? [{ label: t("common:actions.cancel"), onClick: handleReset }]
            : []),
        ]}
        primaryAction={{
          label:
            saveStatus === "saving"
              ? t("common:actions.save") + "..."
              : t("common:actions.save"),
          onClick: handleSave,
          disabled: !hasChanges || saveStatus === "saving",
        }}
      />
    </div>
  );
};

export default CliRawConfigFileEditor;
