/**
 * Admin control state for the org's "Offline sync" policy
 * (`cloud_set_org_offline_sync`, 0013).
 *
 * The current value reads from the org record's `offlineSyncEnabled`
 * (`list_my_orgs`, via `org2CloudOrgsAtom`); a successful save keeps the
 * committed value as an override until the refetched roster catches up —
 * the same idiom as `useOrgRuntimeTelemetry`.
 */
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  commitRefreshedAuth,
  org2CloudAuthAtom,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { ensureFreshSession } from "@src/features/Org2Cloud/org2CloudClient";
import { isFetchTransportError } from "@src/features/Org2Cloud/org2CloudFetchRetry";
import {
  org2CloudOrgsAtom,
  useRefetchOrg2CloudOrgs,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { setOrgOfflineSync } from "@src/features/Org2Cloud/org2CloudSyncClient";

import type { SelectValue } from "./cloudOrgPanelTypes";

export const ORG_OFFLINE_SYNC_ON_VALUE = "on";
export const ORG_OFFLINE_SYNC_OFF_VALUE = "off";

export interface OrgOfflineSyncState {
  /** Select value: `"on"` or `"off"`. */
  value: string;
  enabled: boolean;
  saving: boolean;
  error: string | null;
  handleChange: (value: SelectValue) => Promise<void>;
}

export function useOrgOfflineSync(orgId: string): OrgOfflineSyncState {
  const { t } = useTranslation("navigation");
  const [auth, setAuth] = useAtom(org2CloudAuthAtom);
  const orgs = useAtomValue(org2CloudOrgsAtom);
  const refetchOrgs = useRefetchOrg2CloudOrgs();

  const [override, setOverride] = useState<{
    orgId: string;
    enabled: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest auth via ref (panel idiom): token-refresh writes must not
  // invalidate the change handler.
  const authRef = useRef(auth);
  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    setError(null);
  }, [orgId]);

  const org = orgs.find((candidate) => candidate.orgId === orgId) ?? null;
  const enabled =
    override?.orgId === orgId
      ? override.enabled
      : (org?.offlineSyncEnabled ?? false);

  const handleChange = useCallback(
    async (raw: SelectValue): Promise<void> => {
      const next = String(raw) === ORG_OFFLINE_SYNC_ON_VALUE;
      if (saving) return;
      setError(null);
      setSaving(true);
      try {
        const current = authRef.current;
        if (!current) throw new Error(t("cloud.orgPanel.loadError"));
        const fresh = await ensureFreshSession(current);
        if (!fresh) throw new Error(t("cloud.orgPanel.loadError"));
        commitRefreshedAuth(setAuth, current, fresh);
        await setOrgOfflineSync(fresh.accessToken, orgId, next);
        setOverride({ orgId, enabled: next });
        // Converge the shared org record so the background scheduler and
        // every other consumer see the change without reopening the panel.
        void refetchOrgs();
      } catch (err) {
        setError(
          isFetchTransportError(err)
            ? t("cloud.orgManagement.errors.network")
            : err instanceof Error
              ? err.message
              : String(err)
        );
      } finally {
        setSaving(false);
      }
    },
    [orgId, refetchOrgs, saving, setAuth, t]
  );

  return {
    value: enabled ? ORG_OFFLINE_SYNC_ON_VALUE : ORG_OFFLINE_SYNC_OFF_VALUE,
    enabled,
    saving,
    error,
    handleChange,
  };
}
