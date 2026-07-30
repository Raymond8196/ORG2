/**
 * Sync tab — per-org connection health, last-sync clock, a manual trigger,
 * and the local sync journal ("bug logs").
 *
 * Presentational by design: every value arrives through `status`
 * (`useCloudOrgSyncStatus`), matching how `CloudOrgSettingsSection` consumes
 * `OrgRuntimeTelemetryState`. Nothing here talks to the backend.
 *
 * SECRETS: the connection block renders the endpoint ORIGIN and the signed-in
 * user id only. The Supabase anon key and the access/refresh tokens are never
 * passed in, rendered, or copied.
 */
import type { TFunction } from "i18next";
import React, { useCallback, useMemo } from "react";

import Button from "@src/components/Button";
import type { CloudCapabilities } from "@src/features/Org2Cloud/org2CloudCapabilities";
import type { SyncJournalEntry } from "@src/features/Org2Cloud/org2CloudSyncJournal";
import { useCopyCheck } from "@src/hooks/ui/useCopyCheck";
import {
  SECTION_ACTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import { copyText } from "@src/util/data/clipboard";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import type { CloudOrgSyncStatus } from "./useCloudOrgSyncStatus";

/** Newest slice actually rendered; the buffer itself holds up to 100. */
const RENDERED_LOG_LIMIT = 50;

const CAPABILITY_KEYS = [
  "broadcastSignals",
  "storageSegments",
  "homeEndpoints",
  "teamInboxMentions",
  "memberRuntime",
] as const satisfies readonly (keyof CloudCapabilities)[];

const LEVEL_CLASSES: Record<SyncJournalEntry["level"], string> = {
  info: "bg-fill-2 text-text-3",
  warn: "bg-warning-6/15 text-warning-6",
  error: "bg-danger-6/15 text-danger-6",
};

const LEVEL_LABEL_KEYS: Record<SyncJournalEntry["level"], string> = {
  info: "cloud.orgPanel.sync.levelInfo",
  warn: "cloud.orgPanel.sync.levelWarn",
  error: "cloud.orgPanel.sync.levelError",
};

/** Expiry is a wall-clock comparison, so it stays out of the render body. */
function isExpired(atMs: number | null): boolean {
  return atMs !== null && atMs <= Date.now();
}

function formatAbsolute(atMs: number | null): string {
  if (atMs === null) return "";
  try {
    return new Date(atMs).toLocaleString();
  } catch {
    return "";
  }
}

/** Plain-text rendering of the journal, for the copy button. */
export function formatSyncJournalForCopy(
  entries: readonly SyncJournalEntry[]
): string {
  return entries
    .map((entry) => {
      const parts = [
        formatAbsolute(entry.atMs),
        entry.level.toUpperCase(),
        entry.kind,
      ];
      if (entry.orgId) parts.push(entry.orgId);
      if (entry.code) parts.push(entry.code);
      return `[${parts.join(" | ")}] ${entry.message}`;
    })
    .join("\n");
}

interface CloudOrgSyncSectionProps {
  t: TFunction<"navigation">;
  status: CloudOrgSyncStatus;
}

/** Sync-tab connection, last-sync, manual trigger, and journal blocks. */
export function CloudOrgSyncSection({ t, status }: CloudOrgSyncSectionProps) {
  const visibleEntries = useMemo(
    () => status.entries.slice(0, RENDERED_LOG_LIMIT),
    [status.entries]
  );

  const copyLog = useCallback(async () => {
    await copyText(formatSyncJournalForCopy(visibleEntries));
  }, [visibleEntries]);
  const { copied, handleCopy } = useCopyCheck(copyLog);

  const schemaLabel =
    status.schemaStatus === "checking"
      ? t("cloud.orgPanel.sync.schemaChecking")
      : status.schemaStatus === "matched"
        ? t("cloud.orgPanel.sync.schemaMatched", {
            version: status.expectedSchemaVersion,
          })
        : status.schemaStatus === "mismatched"
          ? t("cloud.orgPanel.sync.schemaMismatch", {
              backend: status.backendSchemaVersion,
              expected: status.expectedSchemaVersion,
            })
          : t("cloud.orgPanel.sync.schemaUnknown");

  const tokenExpiresAtMs = status.tokenExpiresAtMs;
  const tokenExpired = isExpired(tokenExpiresAtMs);
  const lastSuccessAtMs = status.lastSync.lastSuccessAtMs;

  return (
    <>
      <SectionContainer title={t("cloud.orgPanel.sync.connectionTitle")}>
        <SectionRow
          dataTestId="cloud-org-sync-endpoint"
          label={t("cloud.orgPanel.sync.endpointLabel")}
          description={
            status.isOfficialEndpoint
              ? t("cloud.orgPanel.sync.endpointOfficial")
              : t("cloud.orgPanel.sync.endpointCustom")
          }
        >
          <span className="break-all text-[12px] text-text-2">
            {status.endpointOrigin ?? t("cloud.orgPanel.sync.endpointUnknown")}
          </span>
        </SectionRow>

        {status.signedIn ? (
          <>
            <SectionRow
              dataTestId="cloud-org-sync-account"
              label={t("cloud.orgPanel.sync.signedInLabel")}
            >
              <span className="break-all text-[12px] text-text-2">
                {status.userId}
              </span>
            </SectionRow>
            <SectionRow
              dataTestId="cloud-org-sync-token"
              label={t("cloud.orgPanel.sync.tokenExpiresLabel")}
            >
              <span
                className={`text-[12px] ${tokenExpired ? "text-danger-6" : "text-text-2"}`}
              >
                {tokenExpiresAtMs === null
                  ? t("cloud.orgPanel.sync.endpointUnknown")
                  : tokenExpired
                    ? t("cloud.orgPanel.sync.tokenExpired")
                    : `${formatRelativeTime(tokenExpiresAtMs, "long")} · ${formatAbsolute(tokenExpiresAtMs)}`}
              </span>
            </SectionRow>
          </>
        ) : (
          <SectionRow
            dataTestId="cloud-org-sync-signed-out"
            label={t("cloud.orgPanel.sync.signedOut")}
            description={t("cloud.orgPanel.sync.signedOutHint")}
            light
          />
        )}

        <SectionRow
          dataTestId="cloud-org-sync-schema"
          label={t("cloud.orgPanel.sync.schemaLabel")}
        >
          <span
            className={`text-[12px] ${
              status.schemaStatus === "mismatched"
                ? "text-danger-6"
                : status.schemaStatus === "matched"
                  ? "text-success-6"
                  : "text-text-3"
            }`}
            data-testid={`cloud-org-sync-schema-${status.schemaStatus}`}
          >
            {schemaLabel}
          </span>
        </SectionRow>

        <SectionRow
          dataTestId="cloud-org-sync-capabilities"
          label={t("cloud.orgPanel.sync.capabilitiesLabel")}
          align="start"
          layout="vertical"
        >
          {status.capabilities ? (
            <ul className="flex flex-col gap-1">
              {CAPABILITY_KEYS.map((key) => {
                const enabled = status.capabilities?.[key] === true;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2 text-[12px]"
                    data-testid={`cloud-org-sync-capability-${key}`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        enabled ? "bg-success-6" : "bg-fill-3"
                      }`}
                    />
                    <span className="text-text-2">
                      {t(`cloud.orgPanel.sync.capability.${key}`)}
                    </span>
                    <span
                      className={enabled ? "text-success-6" : "text-text-3"}
                    >
                      {enabled
                        ? t("cloud.orgPanel.sync.capabilityEnabled")
                        : t("cloud.orgPanel.sync.capabilityDisabled")}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-[12px] text-text-3">
              {status.capabilitiesLoading
                ? t("cloud.orgPanel.sync.capabilitiesChecking")
                : t("cloud.orgPanel.sync.capabilitiesUnavailable")}
            </span>
          )}
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("cloud.orgPanel.sync.lastSyncTitle")}>
        <SectionRow
          dataTestId="cloud-org-sync-last"
          label={t("cloud.orgPanel.sync.lastSyncLabel")}
        >
          {lastSuccessAtMs === null ? (
            <span
              className="text-[12px] text-text-3"
              data-testid="cloud-org-sync-last-never"
            >
              {t("cloud.orgPanel.sync.lastSyncNever")}
            </span>
          ) : (
            <span
              className="text-[12px] text-text-2"
              data-testid="cloud-org-sync-last-value"
            >
              {`${formatRelativeTime(lastSuccessAtMs, "long")} · ${formatAbsolute(lastSuccessAtMs)}`}
            </span>
          )}
        </SectionRow>
        {status.lastSync.lastPassAtMs !== null &&
        status.lastSync.lastPassAtMs !== lastSuccessAtMs ? (
          <SectionRow
            dataTestId="cloud-org-sync-last-attempt"
            label={t("cloud.orgPanel.sync.lastAttemptLabel")}
          >
            <span className="text-[12px] text-text-3">
              {`${formatRelativeTime(status.lastSync.lastPassAtMs, "long")} · ${formatAbsolute(status.lastSync.lastPassAtMs)}`}
            </span>
          </SectionRow>
        ) : null}
      </SectionContainer>

      <SectionContainer title={t("cloud.orgPanel.sync.manualTitle")}>
        <SectionRow
          dataTestId="cloud-org-sync-manual"
          label={t("cloud.orgPanel.sync.manualLabel")}
          description={t("cloud.orgPanel.sync.manualHelp")}
          align="start"
        >
          <div className={`${SECTION_ACTION_GAP_CLASSES} flex-wrap`}>
            <Button
              htmlType="button"
              size="default"
              variant="primary"
              disabled={status.running}
              loading={status.running}
              data-testid="cloud-org-sync-run"
              onClick={status.runSync}
            >
              {status.running
                ? t("cloud.orgPanel.sync.manualRunning")
                : t("cloud.orgPanel.sync.manualAction")}
            </Button>
            {status.runError ? (
              <span
                className="text-[12px] text-danger-6"
                data-testid="cloud-org-sync-run-error"
              >
                {t("cloud.orgPanel.sync.manualError", {
                  message: status.runError,
                })}
              </span>
            ) : status.runSucceeded ? (
              <span
                className="text-[12px] text-success-6"
                data-testid="cloud-org-sync-run-success"
              >
                {t("cloud.orgPanel.sync.manualSuccess")}
              </span>
            ) : null}
          </div>
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("cloud.orgPanel.sync.logsTitle")}>
        <SectionRow
          dataTestId="cloud-org-sync-logs-actions"
          label={t("cloud.orgPanel.sync.logsHelp")}
          light
        >
          <div className={`${SECTION_ACTION_GAP_CLASSES} flex-wrap`}>
            <Button
              htmlType="button"
              size="default"
              variant="secondary"
              disabled={visibleEntries.length === 0}
              data-testid="cloud-org-sync-logs-copy"
              onClick={handleCopy}
            >
              {copied
                ? t("cloud.orgPanel.sync.logsCopied")
                : t("cloud.orgPanel.sync.logsCopy")}
            </Button>
            <Button
              htmlType="button"
              size="default"
              variant="secondary"
              disabled={status.entries.length === 0}
              data-testid="cloud-org-sync-logs-clear"
              onClick={status.clearLog}
            >
              {t("cloud.orgPanel.sync.logsClear")}
            </Button>
          </div>
        </SectionRow>

        {visibleEntries.length === 0 ? (
          <SectionRow
            dataTestId="cloud-org-sync-logs-empty"
            label={t("cloud.orgPanel.sync.logsEmpty")}
            light
          />
        ) : (
          <SectionRow
            dataTestId="cloud-org-sync-logs"
            layout="vertical"
            showHeader={false}
          >
            <ul className="flex flex-col gap-2">
              {visibleEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-0.5"
                  data-testid="cloud-org-sync-log-entry"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${LEVEL_CLASSES[entry.level]}`}
                      data-testid={`cloud-org-sync-log-level-${entry.level}`}
                    >
                      {t(LEVEL_LABEL_KEYS[entry.level])}
                    </span>
                    <span className="text-text-3">
                      {formatAbsolute(entry.atMs)}
                    </span>
                    <span className="text-text-3">{entry.kind}</span>
                    {entry.orgId ? (
                      <span className="text-text-3">
                        {t("cloud.orgPanel.sync.logsOrg", {
                          orgId: entry.orgId,
                        })}
                      </span>
                    ) : null}
                    {entry.code ? (
                      <span className="rounded bg-fill-2 px-1.5 py-0.5 text-text-2">
                        {entry.code}
                      </span>
                    ) : null}
                  </div>
                  <span className="break-words text-[12px] text-text-2">
                    {entry.message}
                  </span>
                </li>
              ))}
            </ul>
          </SectionRow>
        )}
      </SectionContainer>
    </>
  );
}

export default CloudOrgSyncSection;
