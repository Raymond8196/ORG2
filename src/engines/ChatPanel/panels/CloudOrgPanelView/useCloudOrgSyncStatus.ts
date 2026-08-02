/**
 * Read-only connection/sync state behind the org panel's Sync tab.
 *
 * Everything here is either already-resolved local state (auth atom, endpoint
 * router, sync journal) or a ONE-SHOT probe on mount (schema version,
 * capabilities). There is deliberately no polling: the tab is a diagnostic
 * surface, and the only way to make it re-read the backend is the explicit
 * manual-sync button, which reuses the engine's existing serialized pass.
 *
 * The hook returns a plain state object so `CloudOrgSyncSection` stays a
 * presentational component (the `useOrgRuntimeTelemetry` /
 * `OrgRuntimeTelemetryState` idiom already used by this panel).
 *
 * SECRETS: only `endpoint.supabaseUrl` is exposed, and only so the section can
 * render its ORIGIN. The anon key, access token, and refresh token never leave
 * this module.
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ORG2_CLOUD_EXPECTED_SCHEMA_VERSION } from "@src/features/Org2Cloud/config";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import type { CloudCapabilities } from "@src/features/Org2Cloud/org2CloudCapabilities";
import { getCloudCapabilities } from "@src/features/Org2Cloud/org2CloudCapabilities";
import { schemaVersion } from "@src/features/Org2Cloud/org2CloudClient";
import { endpointForOrg } from "@src/features/Org2Cloud/org2CloudOrgEndpointRouter";
import {
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
  org2CloudRepoScopesAtom,
} from "@src/features/Org2Cloud/org2CloudSyncAtoms";
import {
  type SessionSyncCoverage,
  computeSessionSyncCoverage,
  createOrgRepoScopeResolver,
  pushedSessionIdsForOrg,
} from "@src/features/Org2Cloud/org2CloudSyncCoverage";
import { org2CloudSyncEngine } from "@src/features/Org2Cloud/org2CloudSyncEngine";
import {
  type SyncJournalEntry,
  type SyncJournalLastSyncState,
  clearSyncJournal,
  describeSyncError,
  useLastSyncState,
  useSyncJournal,
} from "@src/features/Org2Cloud/org2CloudSyncJournal";
import { useShareableScopeKeyVersion } from "@src/features/TeamCollaboration/repoScopeResolver";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";

export type SchemaProbeStatus =
  | "checking"
  | "matched"
  | "mismatched"
  | "unknown";

export interface CloudOrgSyncStatus {
  /** Origin of this org's data-plane endpoint (never the anon key). */
  isOfficialEndpoint: boolean;
  signedIn: boolean;
  userId: string | null;
  /** Access-token expiry in unix MILLIseconds (atom stores seconds). */
  tokenExpiresAtMs: number | null;
  expectedSchemaVersion: number;
  backendSchemaVersion: number | null;
  schemaStatus: SchemaProbeStatus;
  capabilities: CloudCapabilities | null;
  capabilitiesLoading: boolean;
  lastSync: SyncJournalLastSyncState;
  /** Per-repo publish coverage across THIS org's repo scopes. */
  coverage: SessionSyncCoverage;
  entries: readonly SyncJournalEntry[];
  running: boolean;
  runSucceeded: boolean;
  runError: string | null;
  /** Never throws and never rejects — failures land in `runError`. */
  runSync: () => void;
  clearLog: () => void;
}

export function useCloudOrgSyncStatus(orgId: string): CloudOrgSyncStatus {
  const auth = useAtomValue(org2CloudAuthAtom);
  const entries = useSyncJournal();
  const lastSync = useLastSyncState();

  const accessToken = auth?.accessToken ?? null;
  const endpoint = useMemo(() => endpointForOrg(orgId), [orgId]);

  // Coverage is derived, not probed: both marker atoms and the roster are
  // already-resolved local state, so the numbers track pushes and retracts
  // live without this diagnostic tab polling anything.
  const sessions = useAtomValue(sessionsAtom);
  const pushedMetadata = useAtomValue(org2CloudPushedMetadataAtom);
  const pushCursors = useAtomValue(org2CloudPushCursorsAtom);
  // The org's OWN repo scopes are the row set: the panel reports on the repos
  // this org can receive, not every repo on the device. The mirror is the same
  // one the push pass matches against, so the rows and the engine agree.
  const orgScopes = useAtomValue(org2CloudRepoScopesAtom)[orgId];
  // Scope matching reads the shareable-scope-key and repo-identity caches,
  // which fill in asynchronously (both bump this one version). The
  // subscription is what turns a cold cache into rows.
  const scopeKeyVersion = useShareableScopeKeyVersion();
  const coverage = useMemo(() => {
    // The version is an invalidation signal, not an input: reading it here is
    // what makes it an honest dependency rather than a suppressed lint rule.
    void scopeKeyVersion;
    return computeSessionSyncCoverage(
      sessions,
      pushedSessionIdsForOrg(orgId, pushedMetadata, pushCursors),
      createOrgRepoScopeResolver(orgScopes)
    );
  }, [
    orgId,
    orgScopes,
    pushCursors,
    pushedMetadata,
    scopeKeyVersion,
    sessions,
  ]);

  const [schemaStatus, setSchemaStatus] =
    useState<SchemaProbeStatus>("checking");
  const [backendSchemaVersion, setBackendSchemaVersion] = useState<
    number | null
  >(null);
  const [capabilities, setCapabilities] = useState<CloudCapabilities | null>(
    null
  );
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runSucceeded, setRunSucceeded] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // One-shot schema probe. Re-runs only when the org's endpoint changes.
  useEffect(() => {
    let cancelled = false;
    setSchemaStatus("checking");
    setBackendSchemaVersion(null);
    void schemaVersion()
      .then((version) => {
        if (cancelled) return;
        setBackendSchemaVersion(version);
        if (version === null) {
          setSchemaStatus("unknown");
          return;
        }
        setSchemaStatus(
          version === ORG2_CLOUD_EXPECTED_SCHEMA_VERSION
            ? "matched"
            : "mismatched"
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSchemaStatus("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint.supabaseUrl]);

  // Capabilities need a token; the probe itself is cached per endpoint.
  useEffect(() => {
    if (!accessToken) {
      setCapabilities(null);
      setCapabilitiesLoading(false);
      return;
    }
    let cancelled = false;
    setCapabilitiesLoading(true);
    void getCloudCapabilities(accessToken)
      .then((probed) => {
        if (cancelled) return;
        setCapabilities(probed);
      })
      .catch(() => {
        if (cancelled) return;
        setCapabilities(null);
      })
      .finally(() => {
        if (cancelled) return;
        setCapabilitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSync = useCallback(() => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    setRunSucceeded(false);
    void (async () => {
      try {
        await org2CloudSyncEngine.runSyncPassAndWaitForDrain();
        if (!mountedRef.current) return;
        setRunSucceeded(true);
      } catch (error) {
        if (!mountedRef.current) return;
        setRunError(describeSyncError(error).message);
      } finally {
        if (mountedRef.current) setRunning(false);
      }
    })();
  }, [running]);

  return {
    // The endpoint URL is deliberately NOT exposed: the panel only reports
    // WHICH KIND of backend this org talks to. Nothing downstream can render
    // the host, so there is no path for it to leak into the UI or the copied
    // journal.
    isOfficialEndpoint: endpoint.isOfficial,
    signedIn: Boolean(auth),
    userId: auth?.userId ?? null,
    tokenExpiresAtMs:
      typeof auth?.expiresAt === "number" ? auth.expiresAt * 1000 : null,
    expectedSchemaVersion: ORG2_CLOUD_EXPECTED_SCHEMA_VERSION,
    backendSchemaVersion,
    schemaStatus,
    capabilities,
    capabilitiesLoading,
    lastSync,
    coverage,
    entries,
    running,
    runSucceeded,
    runError,
    runSync,
    clearLog: clearSyncJournal,
  };
}
