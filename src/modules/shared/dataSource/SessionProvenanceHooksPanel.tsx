import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import type {
  SessionProvenanceHookPlatform,
  SessionProvenanceHookStatus,
} from "@src/api/tauri/rpc/schemas/agentOrgs";
import Switch from "@src/components/Switch";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

const PLATFORMS: ReadonlyArray<{
  id: SessionProvenanceHookPlatform;
  label: string;
}> = [
  { id: "claude_code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
];

type StatusByPlatform = Partial<
  Record<SessionProvenanceHookPlatform, SessionProvenanceHookStatus>
>;
type ErrorByPlatform = Partial<Record<SessionProvenanceHookPlatform, string>>;

function indexStatuses(
  statuses: SessionProvenanceHookStatus[]
): StatusByPlatform {
  return Object.fromEntries(
    statuses.map((status) => [status.platform, status])
  ) as StatusByPlatform;
}

const SessionProvenanceHooksPanel: React.FC = () => {
  const { t } = useTranslation("integrations");
  const [statuses, setStatuses] = useState<StatusByPlatform>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [pendingPlatforms, setPendingPlatforms] = useState<
    Set<SessionProvenanceHookPlatform>
  >(() => new Set());
  const [errors, setErrors] = useState<ErrorByPlatform>({});

  useEffect(() => {
    let cancelled = false;
    rpc.agentOrgs.sessionProvenance
      .status()
      .then((nextStatuses) => {
        if (!cancelled) {
          setStatuses(indexStatuses(nextStatuses));
          setErrors({});
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : String(error);
          setErrors(
            Object.fromEntries(
              PLATFORMS.map(({ id }) => [id, message])
            ) as ErrorByPlatform
          );
        }
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const captureLabel = t("agentOrgs.sessionProvenance.capture", {
    defaultValue: "Capture file interactions",
  });

  const descriptions = useMemo(
    () =>
      Object.fromEntries(
        PLATFORMS.map(({ id }) => {
          const status = statuses[id];
          const error = errors[id];
          if (error) return [id, error];
          if (status && status.enabled !== status.desiredEnabled) {
            return [
              id,
              t("agentOrgs.sessionProvenance.installDrift", {
                defaultValue:
                  "The saved preference and installed hook differ. Toggle capture to repair the managed hook. Config: {{path}}",
                path: status.configPath,
              }),
            ];
          }
          if (status?.configPath) {
            return [
              id,
              t("agentOrgs.sessionProvenance.configPath", {
                defaultValue:
                  "Records file reads and writes as metadata. Prompts, tool output, and file contents are not stored. Config: {{path}}",
                path: status.configPath,
              }),
            ];
          }
          return [
            id,
            t("agentOrgs.sessionProvenance.description", {
              defaultValue:
                "Records file reads and writes as metadata. Prompts, tool output, and file contents are not stored.",
            }),
          ];
        })
      ) as Record<SessionProvenanceHookPlatform, string>,
    [errors, statuses, t]
  );

  const handleChange = useCallback(
    async (platform: SessionProvenanceHookPlatform, enabled: boolean) => {
      const previous = statuses[platform];
      setPendingPlatforms((current) => new Set(current).add(platform));
      setErrors((current) => ({ ...current, [platform]: undefined }));
      setStatuses((current) => ({
        ...current,
        [platform]: current[platform]
          ? {
              ...current[platform],
              enabled,
              desiredEnabled: enabled,
            }
          : current[platform],
      }));

      try {
        const nextStatus = await rpc.agentOrgs.sessionProvenance.setEnabled({
          platform,
          enabled,
        });
        setStatuses((current) => ({
          ...current,
          [platform]: nextStatus,
        }));
      } catch (error) {
        setStatuses((current) => ({
          ...current,
          [platform]: previous,
        }));
        setErrors((current) => ({
          ...current,
          [platform]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setPendingPlatforms((current) => {
          const next = new Set(current);
          next.delete(platform);
          return next;
        });
      }
    },
    [statuses]
  );

  return (
    <div data-testid="session-provenance-hooks-panel">
      <SectionContainer
        title={t("agentOrgs.sessionProvenance.title", {
          defaultValue: "Session Provenance",
        })}
      >
        {PLATFORMS.map(({ id, label }) => {
          const status = statuses[id];
          return (
            <SectionRow
              key={id}
              label={label}
              description={descriptions[id]}
              align="start"
            >
              <Switch
                checked={status?.enabled ?? false}
                disabled={initialLoading && !status}
                loading={pendingPlatforms.has(id)}
                ariaLabel={`${label} — ${captureLabel}`}
                dataTestId={`session-provenance-hook-switch-${id}`}
                onChange={(enabled) => void handleChange(id, enabled)}
              />
            </SectionRow>
          );
        })}
      </SectionContainer>
    </div>
  );
};

export default SessionProvenanceHooksPanel;
