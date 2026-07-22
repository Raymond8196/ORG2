import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { createLogger } from "@src/hooks/logger";
import { createCollabAvatarIdentity } from "@src/store/collaboration/protocol";
import {
  COLLAB_IDENTITY_KIND,
  COLLAB_ROLE,
  COLLAB_SESSION_ACCESS_MODE,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import {
  createDefaultAccessSettings,
  sha256Hex,
  stableStringify,
  toRemoteMetadata,
} from "../TeamCollaboration/collabSyncUtils";
import {
  computeFrozenEventCount,
  splitFrozenIntoSegments,
} from "../TeamCollaboration/engine/collabSyncEngineHelpers";
import { getSessionForkedFrom } from "../TeamCollaboration/forkSession";
import { computeSegmentHash } from "../TeamCollaboration/sync/collabGzip";
import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { broadcastOrgControlChangedToPeers } from "./org2CloudControlBus";
import type { CollabSessionPushCursor } from "./org2CloudSyncAtoms";
import {
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
} from "./org2CloudSyncAtoms";
import * as org2CloudSyncClient from "./org2CloudSyncClient";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";
import {
  type CloudStore,
  EXTERNAL_HISTORY_ACTIVITY_DEBOUNCE_MS,
} from "./org2CloudSyncLifecycle";

const log = createLogger("Org2CloudSyncEngine");

/** Safety TTL for rechecking a session whose events plane was verified clean. */
const EVENTS_CLEAN_TTL_MS = 10 * 60_000;

/** Largest cursor accepted by the backend's int4 `p_after_seq` argument. */
const HEAD_READ_AFTER_SEQ = 2_147_483_647;

/** Client seam so tests inject fetch-free fakes. */
export type Org2CloudSyncClientDeps = Pick<
  typeof org2CloudSyncClient,
  | "upsertSessionMetadata"
  | "appendSessionEvents"
  | "rewriteSessionEvents"
  | "getSessionEvents"
  | "getOrgRepoScopes"
  | "listOrgSessions"
  | "deleteSession"
>;

interface PreparedPushPlan {
  perEventHashes: string[];
  frozenEventCount: number;
  tailEvents: SessionEvent[];
  tailHash: string | null;
  frozenChainHash: string;
}

interface PreparedPushEvents {
  stampAtRead: number;
  events: SessionEvent[];
  plan(): Promise<PreparedPushPlan>;
}

interface CleanEventPlaneStamp {
  verifiedAt: number;
  /** Imported transcript version used for this proof. */
  sourceUpdatedAt?: string;
}

interface ExternalHistoryVersionObservation {
  sourceUpdatedAt: string;
  observedAt: number;
}

function metadataPayloadForHash(
  metadata: RemoteTeammateSessionMetadata
): Partial<RemoteTeammateSessionMetadata> {
  const payload: Partial<RemoteTeammateSessionMetadata> = { ...metadata };
  // These fields are derived by the listing RPC, not authored by
  // cloud_upsert_session_metadata. Excluding them makes a server summary
  // comparable to the exact payload this client would upload.
  // ownerMemberId is also server-authoritative: the synthetic local member
  // uses auth.userId, while the listing returns the org-membership row id.
  // The row id embeds that membership id, so it is server-derived too.
  delete payload.id;
  delete payload.ownerMemberId;
  delete payload.directlySharedWithMe;
  delete payload.eventsEpoch;
  delete payload.eventsFrozenSeq;
  delete payload.eventsCount;
  delete payload.eventsTailHash;
  delete payload.deletedAt;
  delete payload.commentCount;
  delete payload.unresolvedCommentCount;
  return payload;
}

/**
 * Build cloud metadata while restoring fork lineage stripped from Session rows.
 */
export function buildCloudSessionMetadata(
  session: Session,
  orgId: string,
  userId: string,
  displayName: string,
  scopeKey: string | null,
  access: CloudPushAccess,
  avatarUrl?: string
): RemoteTeammateSessionMetadata {
  const org: CollabOrgRecord = { id: orgId, name: "", createdAt: "" };
  const member: CollabMemberRecord = {
    id: userId,
    orgId,
    displayName,
    avatar: createCollabAvatarIdentity(displayName),
    role: COLLAB_ROLE.MEMBER,
    identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    joinedAt: "",
  };
  const settings = {
    ...createDefaultAccessSettings(orgId, userId),
    accessMode: access.accessMode,
    sessionVisibility: { [session.session_id]: access.visibility },
  };
  const withLineage: Session = {
    ...session,
    forkedFrom: getSessionForkedFrom(session),
  };
  return {
    ...toRemoteMetadata(withLineage, org, member, settings, scopeKey),
    ...(avatarUrl ? { ownerAvatarUrl: avatarUrl } : {}),
  };
}

/** True for local sessions that may ever be pushed to the cloud. */
export function isCloudPushCandidate(session: Session): boolean {
  // Imported teammate copies must never round-trip under the local user.
  // The user's own external history has no importedFrom and remains shareable.
  return !session.importedFrom;
}

/**
 * Owns one session's metadata/event push plane, including persisted cursors,
 * event-clean stamps, OCC re-anchors, and retract bookkeeping.
 */
export class Org2CloudSessionSync {
  /** `${orgId}:${sessionId}` to hash of the last upserted metadata. */
  private readonly lastPushedMetadataHashes = new Map<string, string>();
  /** sessionId to orgId to time when the event plane was verified clean. */
  private readonly cleanEventPlanes = new Map<
    string,
    Map<string, CleanEventPlaneStamp>
  >();
  /** A cold-start remote summary may seed each (org, session) only once. */
  private readonly remoteSeedAttemptedKeys = new Set<string>();
  /** Session activity stamp prevents a mid-push write from being marked clean. */
  private readonly eventActivityStamps = new Map<string, number>();
  /** Last write time for quiet-window gating of mutable external histories. */
  private readonly eventActivityAtMs = new Map<string, number>();
  /** Last imported-source version observed from sessionsAtom. */
  private readonly externalHistoryVersions = new Map<
    string,
    ExternalHistoryVersionObservation
  >();
  /** Org-independent event reads and hashing shared across orgs in one pass. */
  private readonly passPushPrepareCache = new Map<
    string,
    Promise<PreparedPushEvents>
  >();

  constructor(
    private readonly getStore: () => CloudStore | null,
    private readonly client: Org2CloudSyncClientDeps
  ) {}

  reset(): void {
    this.lastPushedMetadataHashes.clear();
    this.cleanEventPlanes.clear();
    this.eventActivityStamps.clear();
    this.eventActivityAtMs.clear();
    this.externalHistoryVersions.clear();
    this.passPushPrepareCache.clear();
    this.remoteSeedAttemptedKeys.clear();
  }

  /** Start a new engine pass; prepared events must never leak across passes. */
  beginPass(): void {
    this.passPushPrepareCache.clear();
  }

  /**
   * Keep app-lifetime acceleration state inside the currently reachable data
   * set. Durable cursors/markers remain in Jotai storage until their own
   * retraction/reconcile paths run; these in-memory hashes and clean stamps are
   * only caches, so dropping a dead key can at worst cause one safe recheck.
   */
  prune(
    liveOrgIds: ReadonlySet<string>,
    liveSessionIds: ReadonlySet<string>
  ): void {
    for (const key of this.lastPushedMetadataHashes.keys()) {
      const separatorIndex = key.indexOf(":");
      const orgId = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
      const sessionId =
        separatorIndex === -1 ? "" : key.slice(separatorIndex + 1);
      if (!liveOrgIds.has(orgId) || !liveSessionIds.has(sessionId)) {
        this.lastPushedMetadataHashes.delete(key);
      }
    }
    for (const key of this.remoteSeedAttemptedKeys) {
      const separatorIndex = key.indexOf(":");
      const orgId = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
      const sessionId =
        separatorIndex === -1 ? "" : key.slice(separatorIndex + 1);
      if (!liveOrgIds.has(orgId) || !liveSessionIds.has(sessionId)) {
        this.remoteSeedAttemptedKeys.delete(key);
      }
    }
    for (const [sessionId, byOrg] of this.cleanEventPlanes) {
      if (!liveSessionIds.has(sessionId)) {
        this.cleanEventPlanes.delete(sessionId);
        continue;
      }
      for (const orgId of byOrg.keys()) {
        if (!liveOrgIds.has(orgId)) byOrg.delete(orgId);
      }
      if (byOrg.size === 0) this.cleanEventPlanes.delete(sessionId);
    }
    for (const sessionId of this.eventActivityStamps.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        this.eventActivityStamps.delete(sessionId);
      }
    }
    for (const sessionId of this.eventActivityAtMs.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        this.eventActivityAtMs.delete(sessionId);
      }
    }
    for (const sessionId of this.externalHistoryVersions.keys()) {
      if (!liveSessionIds.has(sessionId)) {
        this.externalHistoryVersions.delete(sessionId);
      }
    }
  }

  /** Drop clean markers and stamp a local event-store write. */
  noteSessionEventActivity(sessionId: string): void {
    this.eventActivityStamps.set(
      sessionId,
      (this.eventActivityStamps.get(sessionId) ?? 0) + 1
    );
    this.eventActivityAtMs.set(sessionId, Date.now());
    this.cleanEventPlanes.delete(sessionId);
  }

  /**
   * Imported CLI files are mutable snapshots, not append-only EventStore
   * streams. During a live turn older normalized records can still change;
   * wait for the same quiet window as the lifecycle timer before doing the
   * expensive full read/normalize/rewrite. Metadata remains live.
   */
  private isExternalHistorySettled(session: Session): boolean {
    const sessionId = session.session_id;
    if (!isImportedHistorySession(sessionId)) return true;
    const now = Date.now();
    const observed = this.externalHistoryVersions.get(sessionId);
    if (!observed || observed.sourceUpdatedAt !== session.updated_at) {
      this.externalHistoryVersions.set(sessionId, {
        sourceUpdatedAt: session.updated_at,
        observedAt: now,
      });
      return false;
    }
    const changedAt = Math.max(
      observed.observedAt,
      this.eventActivityAtMs.get(sessionId) ?? 0
    );
    return now - changedAt >= EXTERNAL_HISTORY_ACTIVITY_DEBOUNCE_MS;
  }

  private isEventPlaneClean(orgId: string, session: Session): boolean {
    const clean = this.cleanEventPlanes.get(session.session_id)?.get(orgId);
    if (!clean || Date.now() - clean.verifiedAt >= EVENTS_CLEAN_TTL_MS) {
      return false;
    }
    return (
      !isImportedHistorySession(session.session_id) ||
      clean.sourceUpdatedAt === session.updated_at
    );
  }

  private markEventPlaneClean(
    orgId: string,
    session: Session,
    stampAtRead: number,
    verifiedAt = Date.now()
  ): void {
    const sessionId = session.session_id;
    if ((this.eventActivityStamps.get(sessionId) ?? 0) !== stampAtRead) return;
    let byOrg = this.cleanEventPlanes.get(sessionId);
    if (!byOrg) {
      byOrg = new Map();
      this.cleanEventPlanes.set(sessionId, byOrg);
    }
    byOrg.set(orgId, {
      verifiedAt,
      sourceUpdatedAt: isImportedHistorySession(sessionId)
        ? session.updated_at
        : undefined,
    });
  }

  /**
   * Seed the volatile cold-start caches from a server-authoritative listing.
   * For imported CLI sessions the local `updated_at` comes from the source
   * transcript and is part of the uploaded metadata. When that payload and
   * the persisted cursor both match the server summary, a restart does not
   * need to read/normalize/hash the entire transcript again.
   */
  async seedFromRemoteSummary(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess,
    remote: RemoteTeammateSessionMetadata
  ): Promise<void> {
    const key = `${orgId}:${session.session_id}`;
    if (this.remoteSeedAttemptedKeys.has(key)) return;
    this.remoteSeedAttemptedKeys.add(key);
    if (
      remote.deletedAt ||
      remote.ownerUserId !== auth.userId ||
      remote.sourceSessionId !== session.session_id
    ) {
      return;
    }
    const displayName =
      auth.profile?.displayName ?? auth.profile?.primaryEmail ?? auth.userId;
    const localMetadata = buildCloudSessionMetadata(
      session,
      orgId,
      auth.userId,
      displayName,
      scopeKey,
      access
    );
    const [localHash, remoteHash] = await Promise.all([
      sha256Hex(stableStringify(metadataPayloadForHash(localMetadata))),
      sha256Hex(stableStringify(metadataPayloadForHash(remote))),
    ]);
    if (localHash !== remoteHash) return;

    this.lastPushedMetadataHashes.set(key, localHash);
    this.setPushedMetadataMarker(orgId, session.session_id);
    if (!isImportedHistorySession(session.session_id)) return;
    const cursor = this.getCursor(orgId, session.session_id);
    if (
      !cursor ||
      remote.eventsEpoch !== cursor.epoch ||
      remote.eventsFrozenSeq !== cursor.frozenSeq ||
      remote.eventsCount !== cursor.pushedCount ||
      (remote.eventsTailHash ?? null) !== cursor.tailHash
    ) {
      return;
    }
    this.markEventPlaneClean(
      orgId,
      session,
      this.eventActivityStamps.get(session.session_id) ?? 0
    );
  }

  private getCursor(
    orgId: string,
    sessionId: string
  ): CollabSessionPushCursor | undefined {
    return this.getStore()?.get(org2CloudPushCursorsAtom)[
      `${orgId}:${sessionId}`
    ];
  }

  private setCursor(cursor: CollabSessionPushCursor): void {
    this.getStore()?.set(org2CloudPushCursorsAtom, (current) => ({
      ...current,
      [`${cursor.orgId}:${cursor.sessionId}`]: cursor,
    }));
  }

  private async computeFrozenChainHash(
    perEventHashes: string[],
    frozenEventCount: number
  ): Promise<string> {
    return sha256Hex(perEventHashes.slice(0, frozenEventCount).join("\n"));
  }

  /** Force the next metadata plane to upsert even if its bytes are unchanged. */
  invalidatePushedMetadataHash(orgId: string, sessionId: string): void {
    this.lastPushedMetadataHashes.delete(`${orgId}:${sessionId}`);
  }

  /** Whether local durable state proves this session was previously pushed. */
  wasCloudPushed(orgId: string, sessionId: string): boolean {
    const key = `${orgId}:${sessionId}`;
    return (
      this.lastPushedMetadataHashes.has(key) ||
      this.getPushedMetadataMarker(orgId, sessionId) ||
      this.getCursor(orgId, sessionId) !== undefined
    );
  }

  private getPushedMetadataMarker(orgId: string, sessionId: string): boolean {
    return (
      this.getStore()?.get(org2CloudPushedMetadataAtom)[
        `${orgId}:${sessionId}`
      ] === true
    );
  }

  private setPushedMetadataMarker(orgId: string, sessionId: string): void {
    const key = `${orgId}:${sessionId}`;
    this.getStore()?.set(org2CloudPushedMetadataAtom, (current) =>
      current[key] ? current : { ...current, [key]: true }
    );
  }

  private clearPushedMetadataMarker(orgId: string, sessionId: string): void {
    const key = `${orgId}:${sessionId}`;
    this.getStore()?.set(org2CloudPushedMetadataAtom, (current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  private clearCursor(orgId: string, sessionId: string): void {
    const key = `${orgId}:${sessionId}`;
    this.getStore()?.set(org2CloudPushCursorsAtom, (current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /** Soft-tombstone a prior push and clear every local pushed marker. */
  async retractSession(
    auth: Org2CloudAuthState,
    orgId: string,
    sessionId: string
  ): Promise<void> {
    try {
      await this.client.deleteSession(auth.accessToken, orgId, sessionId);
    } catch (error) {
      if (!isOrg2SyncErrorCode(error, "ORG2_SESSION_NOT_FOUND")) throw error;
    }
    this.invalidatePushedMetadataHash(orgId, sessionId);
    this.clearPushedMetadataMarker(orgId, sessionId);
    this.clearCursor(orgId, sessionId);
    broadcastOrgControlChangedToPeers(orgId, "sessions");
  }

  private async upsertMetadataIfChanged(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess
  ): Promise<void> {
    const displayName =
      auth.profile?.displayName ?? auth.profile?.primaryEmail ?? auth.userId;
    const metadata = buildCloudSessionMetadata(
      session,
      orgId,
      auth.userId,
      displayName,
      scopeKey,
      access,
      auth.profile?.avatarUrl
    );
    const key = `${orgId}:${session.session_id}`;
    const hash = await sha256Hex(stableStringify(metadata));
    if (this.lastPushedMetadataHashes.get(key) === hash) return;
    await this.client.upsertSessionMetadata(
      auth.accessToken,
      orgId,
      session.session_id,
      metadata
    );
    this.lastPushedMetadataHashes.set(key, hash);
    this.setPushedMetadataMarker(orgId, session.session_id);
    broadcastOrgControlChangedToPeers(orgId, "sessions");
  }

  /** Load the complete native or external-history transcript for upload. */
  async loadPushEvents(sessionId: string): Promise<SessionEvent[]> {
    if (isImportedHistorySession(sessionId)) {
      const source = getImportedHistorySourceBySessionId(sessionId);
      if (!source) return [];
      const chunks = await source.loadFullTranscriptChunks(sessionId);
      if (!Array.isArray(chunks) || chunks.length === 0) return [];
      return processChunksRust(chunks, sessionId);
    }
    return eventStoreProxy.getPersistedEvents(sessionId);
  }

  private preparePushEventsForPass(
    sessionId: string
  ): Promise<PreparedPushEvents> {
    const cached = this.passPushPrepareCache.get(sessionId);
    if (cached) return cached;
    const prepared = (async (): Promise<PreparedPushEvents> => {
      const stampAtRead = this.eventActivityStamps.get(sessionId) ?? 0;
      const events = await this.loadPushEvents(sessionId);
      let planPromise: Promise<PreparedPushPlan> | null = null;
      const plan = (): Promise<PreparedPushPlan> => {
        if (!planPromise) {
          planPromise = (async () => {
            const perEventHashes = await Promise.all(
              events.map((event) => sha256Hex(stableStringify(event)))
            );
            const frozenEventCount = computeFrozenEventCount(events);
            const tailEvents = events.slice(frozenEventCount);
            const tailHash =
              tailEvents.length > 0
                ? await computeSegmentHash(tailEvents)
                : null;
            const frozenChainHash = await this.computeFrozenChainHash(
              perEventHashes,
              frozenEventCount
            );
            return {
              perEventHashes,
              frozenEventCount,
              tailEvents,
              tailHash,
              frozenChainHash,
            };
          })();
        }
        return planPromise;
      };
      return { stampAtRead, events, plan };
    })();
    this.passPushPrepareCache.set(sessionId, prepared);
    return prepared;
  }

  async pushSession(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess
  ): Promise<void> {
    const sessionId = session.session_id;
    if (access.accessMode === COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      // A metadata-only pass invalidates local segment knowledge. If policy
      // later rises to full replay, rebuild the authoritative transcript.
      this.cleanEventPlanes.get(sessionId)?.delete(orgId);
      this.clearCursor(orgId, sessionId);
      return;
    }
    // The external-history scanner updates sessionsAtom directly, without an
    // EventStore notification. Gate on the source's updated_at as well as the
    // event-store stamp, and defer metadata together with replay so a live CLI
    // turn does not produce one cloud upsert per scanner refresh.
    if (!this.isExternalHistorySettled(session)) return;
    if (this.isEventPlaneClean(orgId, session)) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      return;
    }
    const { stampAtRead, events, plan } =
      await this.preparePushEventsForPass(sessionId);
    const cursor = this.getCursor(orgId, sessionId);
    if (!cursor && events.length === 0) {
      await this.upsertMetadataIfChanged(
        auth,
        orgId,
        session,
        scopeKey,
        access
      );
      this.markEventPlaneClean(orgId, session, stampAtRead);
      return;
    }
    if (cursor && events.length < cursor.pushedCount) {
      log.warn(
        `persisted read for ${sessionId} returned ${events.length} events ` +
          `but the cloud cursor covers ${cursor.pushedCount}; skipping`
      );
      return;
    }

    const {
      perEventHashes,
      frozenEventCount,
      tailEvents,
      tailHash,
      frozenChainHash,
    } = await plan();

    if (cursor) {
      let frozenIntact = frozenEventCount >= cursor.frozenEventCount;
      if (frozenIntact && cursor.frozenEventCount > 0) {
        const chainAtCursor =
          cursor.frozenEventCount === frozenEventCount
            ? frozenChainHash
            : await this.computeFrozenChainHash(
                perEventHashes,
                cursor.frozenEventCount
              );
        frozenIntact = chainAtCursor === cursor.frozenChainHash;
      }

      if (frozenIntact) {
        const newFrozenEvents = events.slice(
          cursor.frozenEventCount,
          frozenEventCount
        );
        if (
          newFrozenEvents.length === 0 &&
          tailHash === cursor.tailHash &&
          events.length === cursor.pushedCount
        ) {
          await this.upsertMetadataIfChanged(
            auth,
            orgId,
            session,
            scopeKey,
            access
          );
          this.markEventPlaneClean(orgId, session, stampAtRead);
          return;
        }
        await this.upsertMetadataIfChanged(
          auth,
          orgId,
          session,
          scopeKey,
          access
        );
        const frozenSegments = splitFrozenIntoSegments(
          newFrozenEvents,
          cursor.frozenSeq + 1
        );
        try {
          await this.client.appendSessionEvents(auth.accessToken, {
            orgId,
            sessionId,
            expectedEpoch: cursor.epoch,
            expectedFrozenSeq: cursor.frozenSeq,
            expectedTailHash: cursor.tailHash,
            newFrozenSegments: frozenSegments,
            tail: tailEvents.length > 0 ? tailEvents : null,
            totalCount: events.length,
          });
          this.setCursor({
            orgId,
            sessionId,
            epoch: cursor.epoch,
            frozenSeq: cursor.frozenSeq + frozenSegments.length,
            pushedCount: events.length,
            frozenEventCount,
            frozenChainHash,
            tailHash,
          });
          broadcastOrgControlChangedToPeers(orgId, "sessions");
          this.markEventPlaneClean(orgId, session, stampAtRead);
          return;
        } catch (error) {
          if (!isOrg2SyncErrorCode(error, "ORG2_CONFLICT")) throw error;
          await this.rewriteSession(auth, orgId, session, scopeKey, access, {
            events,
            frozenEventCount,
            frozenChainHash,
            tailEvents,
            tailHash,
            newEpoch: null,
          });
          this.markEventPlaneClean(orgId, session, stampAtRead);
          return;
        }
      }

      await this.rewriteSession(auth, orgId, session, scopeKey, access, {
        events,
        frozenEventCount,
        frozenChainHash,
        tailEvents,
        tailHash,
        newEpoch: cursor.epoch + 1,
      });
      this.markEventPlaneClean(orgId, session, stampAtRead);
      return;
    }

    await this.rewriteSession(auth, orgId, session, scopeKey, access, {
      events,
      frozenEventCount,
      frozenChainHash,
      tailEvents,
      tailHash,
      newEpoch: 1,
    });
    this.markEventPlaneClean(orgId, session, stampAtRead);
  }

  /** Full epoch rewrite; conflicts re-anchor on the current server epoch once. */
  private async rewriteSession(
    auth: Org2CloudAuthState,
    orgId: string,
    session: Session,
    scopeKey: string | null,
    access: CloudPushAccess,
    plan: {
      events: SessionEvent[];
      frozenEventCount: number;
      frozenChainHash: string;
      tailEvents: SessionEvent[];
      tailHash: string | null;
      newEpoch: number | null;
    }
  ): Promise<void> {
    const sessionId = session.session_id;
    let epoch = plan.newEpoch;
    let reanchored = epoch === null;
    if (epoch === null) {
      epoch = (await this.readServerEpoch(auth, orgId, sessionId)) + 1;
    }
    await this.upsertMetadataIfChanged(auth, orgId, session, scopeKey, access);
    const frozenSegments = splitFrozenIntoSegments(
      plan.events.slice(0, plan.frozenEventCount),
      1
    );
    for (;;) {
      try {
        await this.client.rewriteSessionEvents(auth.accessToken, {
          orgId,
          sessionId,
          newEpoch: epoch,
          frozenSegments,
          tail: plan.tailEvents.length > 0 ? plan.tailEvents : null,
          totalCount: plan.events.length,
        });
        this.setCursor({
          orgId,
          sessionId,
          epoch,
          frozenSeq: frozenSegments.length,
          pushedCount: plan.events.length,
          frozenEventCount: plan.frozenEventCount,
          frozenChainHash: plan.frozenChainHash,
          tailHash: plan.tailHash,
        });
        broadcastOrgControlChangedToPeers(orgId, "sessions");
        return;
      } catch (error) {
        if (!isOrg2SyncErrorCode(error, "ORG2_CONFLICT") || reanchored) {
          throw error;
        }
        reanchored = true;
        epoch = (await this.readServerEpoch(auth, orgId, sessionId)) + 1;
      }
    }
  }

  private async readServerEpoch(
    auth: Org2CloudAuthState,
    orgId: string,
    sessionId: string
  ): Promise<number> {
    const snapshot = await this.client.getSessionEvents(
      auth.accessToken,
      orgId,
      sessionId,
      { afterSeq: HEAD_READ_AFTER_SEQ }
    );
    return snapshot.epoch ?? 0;
  }
}
