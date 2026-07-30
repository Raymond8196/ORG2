/**
 * Chat pane → Runtime → Team: teammates' shared runtime — machine load,
 * usage/cost headlines, builder type, installed agents — read from ORG2 Cloud
 * (`cloud_list_member_runtime`) for the selected cloud org.
 *
 * The panel is read-only: opting out of sharing lives in the privacy settings
 * (`privacy.shareRuntimeWithOrg`), not here.
 */
import { RefreshCw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { externalCliSourcesDetect } from "@src/api/tauri/externalHistory/detection";
import Button from "@src/components/Button";
import Select from "@src/components/Select";
import { useOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import { useRefreshSpin } from "@src/hooks/ui";
import {
  SECTION_GAP_CLASSES,
  SECTION_SUBHEADING_CLASSES,
} from "@src/modules/shared/layouts/SectionLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import TeamMemberCard, {
  type AgentCatalog,
  type AgentCatalogEntry,
} from "./TeamMemberCard";
import TeamMemberDetail from "./TeamMemberDetail";
import { useTeamRuntimeRoster } from "./useTeamRuntimeRoster";

const EMPTY_AGENT_CATALOG: AgentCatalog = new Map<string, AgentCatalogEntry>();

/**
 * Installed-agent ids are stable provider ids; display names and icons come
 * from the local detection catalog (entries exist for every provider
 * regardless of local install status). One probe per panel mount.
 */
function useAgentCatalog(): AgentCatalog {
  const [catalog, setCatalog] = useState<AgentCatalog>(EMPTY_AGENT_CATALOG);
  useEffect(() => {
    let cancelled = false;
    void externalCliSourcesDetect()
      .then((probes) => {
        if (cancelled) return;
        setCatalog(
          new Map(
            probes.map((probe) => [
              probe.sourceId,
              { displayName: probe.displayName, iconId: probe.iconId },
            ])
          )
        );
      })
      .catch(() => {
        // Catalog resolution is cosmetic; raw provider ids still render.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}

/** Chat pane → Runtime → Team: the member-runtime roster. */
export default function TeamRuntimePanel() {
  const { t, i18n } = useTranslation("teamRuntime");
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const roster = useTeamRuntimeRoster();
  const agentCatalog = useAgentCatalog();
  const signIn = useOrg2CloudSignIn();

  const [openMemberId, setOpenMemberId] = useState<string | null>(null);

  // One clock per render pass so staleness and the today/7d fold agree across
  // every card. Quantized to the whole minute (org intervals are >=15min, so
  // ~1min staleness granularity is invisible) so an unrelated re-render (a
  // click, a settings change) recomputes the SAME nowMs value instead of a
  // strictly-increasing one — otherwise every card's `nowMs` prop would
  // differ by construction and the `TeamMemberCard` React.memo comparison
  // could never hold. The minute quantization is exactly what makes the read
  // render-stable, so the purity rule's concern doesn't apply here.
  // eslint-disable-next-line react-hooks/purity -- quantized clock, see above
  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;

  // Leaving the org scope or losing the member closes the drilldown.
  useEffect(() => {
    setOpenMemberId(null);
  }, [roster.selectedOrgId, roster.currentUserId]);

  const { spinClass, handleClick: handleRefreshClick } = useRefreshSpin(
    roster.refresh,
    roster.refreshing
  );

  const orgOptions = useMemo(
    () =>
      roster.orgs.map((org) => ({
        value: org.orgId,
        label: org.name,
        dataTestId: `team-runtime-org-${org.orgId}`,
      })),
    [roster.orgs]
  );

  const openMember =
    openMemberId !== null
      ? (roster.members.find((member) => member.userId === openMemberId) ??
        null)
      : null;

  // Stable across renders (setState setters never change identity) so the
  // `TeamMemberCard` React.memo comparison isn't busted by a fresh closure
  // every render — each card calls back with its own userId instead of
  // capturing it in a per-card arrow function at the call site.
  const handleOpenMember = useCallback((userId: string) => {
    setOpenMemberId(userId);
  }, []);

  let content: ReactNode;
  switch (roster.phase) {
    case "signedOut":
      content = (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("signedOut.title")}
          subtitle={t("signedOut.subtitle")}
          action={{
            label: t("signedOut.action"),
            onClick: signIn,
            variant: "primary",
            dataTestId: "team-runtime-sign-in",
          }}
        />
      );
      break;
    case "noOrgs":
      content = (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("noOrgs.title")}
          subtitle={t("noOrgs.subtitle")}
        />
      );
      break;
    case "unsupported":
      content = (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("unsupported.title")}
          subtitle={t("unsupported.subtitle")}
        />
      );
      break;
    case "disabled":
      content = (
        <Placeholder
          variant="empty"
          placement="detail-panel"
          title={t("disabled.title")}
          subtitle={
            roster.isSelectedOrgAdmin
              ? t("disabled.adminSubtitle")
              : t("disabled.subtitle")
          }
        />
      );
      break;
    case "error":
      content = (
        <Placeholder
          variant="error"
          placement="detail-panel"
          title={t("loadError")}
          subtitle={roster.error ?? undefined}
          onRetry={roster.refresh}
        />
      );
      break;
    case "loading":
      content = <Placeholder variant="loading" placement="detail-panel" />;
      break;
    case "ready":
      if (openMember) {
        content = (
          <TeamMemberDetail
            entry={openMember}
            orgId={roster.selectedOrgId ?? ""}
            getFreshAccessToken={roster.getFreshAccessToken}
            agentCatalog={agentCatalog}
            language={language}
            onBack={() => setOpenMemberId(null)}
          />
        );
      } else if (roster.members.length === 0) {
        content = (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("empty.title")}
            subtitle={t("empty.subtitle")}
          />
        );
      } else {
        content = (
          <div
            className="grid grid-cols-1 gap-3 @[640px]:grid-cols-2"
            data-testid="team-runtime-grid"
          >
            {roster.members.map((member) => (
              <TeamMemberCard
                key={member.userId}
                entry={member}
                telemetry={roster.telemetry}
                nowMs={nowMs}
                agentCatalog={agentCatalog}
                isSelf={member.userId === roster.currentUserId}
                onOpen={handleOpenMember}
              />
            ))}
          </div>
        );
      }
      break;
  }

  return (
    <div className={SECTION_GAP_CLASSES} data-testid="team-runtime-panel">
      <div
        className="flex min-h-9 flex-wrap items-center justify-between gap-3"
        data-testid="team-runtime-controls"
      >
        <h3 className={SECTION_SUBHEADING_CLASSES}>{t("title")}</h3>
        <div className="flex min-w-0 items-center gap-2">
          {roster.orgs.length > 1 ? (
            <Select
              value={roster.selectedOrgId ?? undefined}
              options={orgOptions}
              onChange={(value) => roster.selectOrg(String(value))}
              variant="ghost"
              size="small"
              dataTestId="team-runtime-org-select"
            />
          ) : null}
          {roster.phase !== "signedOut" ? (
            <Button
              htmlType="button"
              variant="tertiary"
              appearance="ghost"
              size="small"
              disabled={roster.refreshing}
              aria-label={t("refresh")}
              title={t("refresh")}
              onClick={handleRefreshClick}
              icon={<RefreshCw size={14} className={spinClass} />}
              data-testid="team-runtime-refresh"
            >
              {t("refresh")}
            </Button>
          ) : null}
        </div>
      </div>

      {content}
    </div>
  );
}
