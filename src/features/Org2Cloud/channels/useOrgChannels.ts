/**
 * Data hook for an org's channel list (Slack-style sidebar section and the
 * channel dialogs).
 *
 * The `useTeamRuntimeRoster` shape: fresh-token resolution via
 * `ensureFreshSession` + `commitRefreshedAuth`, the `orgChannels` capability
 * probe, identity-keyed state wiped on account switch, a monotonic request
 * counter dropping late completions, refetch on the hidden → visible edge —
 * plus a subscription to `org2CloudChannelsVersionAtom`, which the realtime
 * `channels` signal (0014) bumps. Strictly event-driven; no polling.
 */
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getCloudCapabilities } from "@src/features/Org2Cloud/org2CloudCapabilities";
import { createLogger } from "@src/hooks/logger";
import { onWindowFocusRegained } from "@src/util/core/windowFocus";

import { org2CloudChannelsVersionAtom } from "./channelsAtom";
import { listCloudChannels } from "./channelsClient";
import { useFreshChannelAccessToken } from "./components/useChannelDialogAccess";
import type { CloudChannel, CloudChannelsList } from "./types";

const log = createLogger("OrgChannels");

export type OrgChannelsPhase =
  | "signedOut"
  | "loading"
  | "unsupported"
  | "error"
  | "ready";

export interface OrgChannelsState {
  phase: OrgChannelsPhase;
  /** Non-archived channels, server-sorted alphabetically. */
  channels: CloudChannel[];
  /** Archived channels; only populated when `includeArchived` was requested. */
  archivedChannels: CloudChannel[];
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
  /** Fresh access token for follow-up RPCs (create/archive/delete dialogs). */
  getFreshAccessToken: () => Promise<string>;
  currentUserId: string | null;
}

const NO_CHANNELS: CloudChannel[] = [];
const listInFlightByIdentityScope = new Map<
  string,
  Promise<CloudChannelsList>
>();

async function listCloudChannelsSingleFlight(
  key: string,
  load: () => Promise<CloudChannelsList>
): Promise<CloudChannelsList> {
  const existing = listInFlightByIdentityScope.get(key);
  if (existing) return existing;
  const request = load();
  listInFlightByIdentityScope.set(key, request);
  try {
    return await request;
  } finally {
    if (listInFlightByIdentityScope.get(key) === request) {
      listInFlightByIdentityScope.delete(key);
    }
  }
}

/**
 * `orgChannels` joins `CloudCapabilities` with the plumbing change; read it
 * structurally so absent ⇒ unsupported against older probe shapes.
 */
function hasOrgChannelsCapability(capabilities: unknown): boolean {
  return Boolean(
    capabilities &&
    typeof capabilities === "object" &&
    (capabilities as { orgChannels?: unknown }).orgChannels === true
  );
}

export function useOrgChannels(
  orgId: string | null,
  options?: { includeArchived?: boolean }
): OrgChannelsState {
  const auth = useAtomValue(org2CloudAuthAtom);
  const includeArchived = options?.includeArchived ?? false;
  const channelsVersion = useAtomValue(org2CloudChannelsVersionAtom);
  const versionForOrg = orgId ? (channelsVersion[orgId] ?? 0) : 0;

  // null = probe not answered yet for this sign-in.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [channels, setChannels] = useState<CloudChannel[] | null>(null);
  const [channelsKey, setChannelsKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;
  const listKey = authIdentityKey
    ? `${authIdentityKey}|${orgId ?? ""}|${includeArchived ? "a" : ""}`
    : null;

  // Cloud fetches may settle after an org/account switch; a monotonic
  // counter drops late completions.
  const requestRef = useRef(0);
  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  // Identity switches are a hard visibility boundary (orgs-atom idiom).
  useEffect(() => {
    setSupported(null);
    setChannels(null);
    setChannelsKey(null);
    setError(null);
  }, [authIdentityKey]);

  // One token helper for the whole channels slice (the dialogs' hook) — a
  // second byte-equivalent copy here kept drifting risk alive.
  const getFreshAccessToken = useFreshChannelAccessToken();

  useEffect(() => {
    if (!authIdentityKey || !orgId || !listKey) return;
    let cancelled = false;
    const seq = ++requestRef.current;
    void (async () => {
      setFetching(true);
      setError(null);
      try {
        const accessToken = await getFreshAccessToken();
        const capabilities = await getCloudCapabilities(accessToken);
        const isSupported = hasOrgChannelsCapability(capabilities);
        if (cancelled || seq !== requestRef.current) return;
        setSupported(isSupported);
        if (!isSupported) return;
        const page = await listCloudChannelsSingleFlight(listKey, () =>
          listCloudChannels(accessToken, orgId, { includeArchived })
        );
        if (cancelled || seq !== requestRef.current) return;
        setChannels(page.channels);
        setChannelsKey(
          `${authIdentityKey}|${orgId}|${includeArchived ? "a" : ""}`
        );
      } catch (err) {
        log.warn("org channels fetch failed:", err);
        if (!cancelled && seq === requestRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled && seq === requestRef.current) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authIdentityKey,
    orgId,
    listKey,
    includeArchived,
    refreshNonce,
    versionForOrg,
    getFreshAccessToken,
  ]);

  const refresh = useCallback(() => {
    setRefreshNonce((nonce) => nonce + 1);
  }, []);

  // A background window can release its Realtime lease after the blur grace
  // without becoming document-hidden. Refetch on either focus regain or the
  // hidden → visible edge so its authoritative list converges even if the
  // reconnect signal is delayed. Identical concurrent consumers remain
  // coalesced by the identity-scoped single-flight map above.
  useEffect(() => {
    if (!authIdentityKey) return;
    return onWindowFocusRegained(refresh);
  }, [authIdentityKey, refresh]);

  const visibleChannels =
    channelsKey !== null && channelsKey === listKey ? channels : null;

  let phase: OrgChannelsPhase;
  if (!auth) {
    phase = "signedOut";
  } else if (!orgId) {
    phase = "loading";
  } else if (visibleChannels === null && error !== null) {
    phase = "error";
  } else if (supported === false) {
    phase = "unsupported";
  } else if (supported === null || visibleChannels === null) {
    phase = "loading";
  } else {
    phase = "ready";
  }

  const list = visibleChannels ?? NO_CHANNELS;
  const channelPartitions = useMemo(
    () => ({
      channels: list.filter((channel) => channel.archivedAt === null),
      archivedChannels: includeArchived
        ? list.filter((channel) => channel.archivedAt !== null)
        : NO_CHANNELS,
    }),
    [includeArchived, list]
  );
  return {
    phase,
    channels: channelPartitions.channels,
    archivedChannels: channelPartitions.archivedChannels,
    error,
    refreshing: fetching,
    refresh,
    getFreshAccessToken,
    currentUserId: auth?.userId ?? null,
  };
}

export const __ORG_CHANNELS_INTERNALS = {
  reset: () => listInFlightByIdentityScope.clear(),
};
