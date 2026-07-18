import type { TFunction } from "i18next";
import React from "react";

import Button from "@src/components/Button";
import type { ScopeQuotaView } from "@src/features/Org2Cloud/org2CloudScopeQuota";
import RepoScopePicker from "@src/features/TeamCollaboration/components/RepoScopePicker";
import {
  SECTION_DESCRIPTION_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

interface CloudOrgRepoScopesTabProps {
  t: TFunction<"navigation">;
  isAdmin: boolean;
  savedScopes: string[];
  draftScopes: string[];
  setDraftScopes: React.Dispatch<React.SetStateAction<string[]>>;
  scopesDirty: boolean;
  scopeQuota: ScopeQuotaView | null;
  savingScopes: boolean;
  scopesSaved: boolean;
  scopesError: string | null;
  onSaveScopes: () => Promise<void>;
  openCloudBillingPage: () => void;
}

/** Admin repo-scope editor and member read-only scope inventory. */
export function CloudOrgRepoScopesTab({
  t,
  isAdmin,
  savedScopes,
  draftScopes,
  setDraftScopes,
  scopesDirty,
  scopeQuota,
  savingScopes,
  scopesSaved,
  scopesError,
  onSaveScopes,
  openCloudBillingPage,
}: CloudOrgRepoScopesTabProps) {
  const coolingRows =
    scopeQuota && scopeQuota.coolingRows.length > 0
      ? scopeQuota.coolingRows.map((row) => (
          <div key={row.scopeKey} data-testid="cloud-org-cooling-scope">
            <SectionRow
              label={<span title={row.scopeKey}>{row.scopeKey}</span>}
              truncateLabel
              light
            >
              <span className="text-[12px] text-text-3">
                {t("cloud.orgPanel.scopeCoolingRow", { days: row.daysLeft })}
              </span>
            </SectionRow>
          </div>
        ))
      : null;

  return (
    <SectionContainer
      title={
        scopeQuota
          ? `${t("cloud.orgPanel.repoScopesTitle")} · ${scopeQuota.counterLabel}`
          : t("cloud.orgPanel.repoScopesTitle")
      }
    >
      <div data-testid="cloud-org-repo-scope">
        <SectionRow showHeader={false}>
          <p className={`m-0 ${SECTION_DESCRIPTION_CLASSES}`}>
            {t("cloud.orgPanel.repoScopesHelp")}
          </p>
        </SectionRow>
        {isAdmin ? (
          <>
            {draftScopes.length === 0 && !coolingRows ? (
              <SectionRow label={t("cloud.orgPanel.repoScopesEmpty")} light />
            ) : (
              draftScopes.map((path) => (
                <SectionRow
                  key={path}
                  label={<span title={path}>{path}</span>}
                  truncateLabel
                >
                  <Button
                    htmlType="button"
                    size="default"
                    variant="secondary"
                    onClick={() =>
                      setDraftScopes(
                        draftScopes.filter((scope) => scope !== path)
                      )
                    }
                  >
                    {t("cloud.orgPanel.removeRepoScope")}
                  </Button>
                </SectionRow>
              ))
            )}
            {coolingRows}
            <SectionRow showHeader={false}>
              <RepoScopePicker
                selectedKeys={draftScopes}
                onChange={setDraftScopes}
                disabled={savingScopes || Boolean(scopeQuota?.atCap)}
              />
            </SectionRow>
            {scopeQuota?.atCap ? (
              <SectionRow showHeader={false}>
                <div
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-1 px-3 py-2 text-[12px] text-warning-6"
                  data-testid="cloud-org-scope-cap-upgrade"
                >
                  <span>
                    {t("cloud.orgPanel.scopeCapReached", {
                      used: scopeQuota.used,
                      cap: scopeQuota.cap,
                    })}
                  </span>
                  <Button
                    htmlType="button"
                    size="default"
                    variant="warning"
                    appearance="ghost"
                    onClick={openCloudBillingPage}
                    data-testid="cloud-org-scope-cap-upgrade-link"
                  >
                    {t("cloud.orgPanel.upgrade")}
                  </Button>
                </div>
              </SectionRow>
            ) : null}
            <SectionRow showHeader={false}>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  htmlType="button"
                  size="default"
                  variant="primary"
                  onClick={() => void onSaveScopes()}
                  disabled={!scopesDirty || savingScopes}
                  loading={savingScopes}
                  data-testid="cloud-org-save-repo-scopes"
                >
                  {t("cloud.orgPanel.saveRepoScopes")}
                </Button>
                {scopesSaved ? (
                  <span className="text-[12px] text-success-6">
                    {t("cloud.orgPanel.repoScopesSaved")}
                  </span>
                ) : null}
                {scopesError ? (
                  <span className="text-[12px] text-danger-6">
                    {scopesError}
                  </span>
                ) : null}
              </div>
            </SectionRow>
          </>
        ) : (
          <>
            {savedScopes.length === 0 && !coolingRows ? (
              <SectionRow label={t("cloud.orgPanel.repoScopesEmpty")} light />
            ) : (
              savedScopes.map((path) => (
                <SectionRow
                  key={path}
                  label={<span title={path}>{path}</span>}
                  truncateLabel
                />
              ))
            )}
            {coolingRows}
          </>
        )}
      </div>
    </SectionContainer>
  );
}

export default CloudOrgRepoScopesTab;
