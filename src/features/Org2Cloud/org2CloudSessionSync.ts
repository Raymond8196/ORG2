import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { createLogger } from "@src/hooks/logger";
import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";
import { isImportedHistorySession } from "@src/util/session/sessionDispatch";

import {
  sha256Hex,
  stableStringify,
} from "../TeamCollaboration/collabSyncUtils";
import {
  computeFrozenEventCount,
  splitFrozenIntoSegments,
} from "../TeamCollaboration/engine/collabSyncEngineHelpers";
import { computeSegmentHash } from "../TeamCollaboration/sync/collabGzip";
import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { broadcastOrgControlChangedToPeers } from "./org2CloudControlBus";
import {
  buildCloudSessionMetadata,
  metadataPayloadForHash,
} from "./org2CloudSessionSync.metadata";
import { Org2CloudSessionSyncState } from "./org2CloudSessionSync.state";
import type {
  Org2CloudSyncClientDeps,
  PreparedPushEvents,
  PreparedPushPlan,
} from "./org2CloudSessionSync.types";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";
import type { CloudStore } from "./org2CloudSyncLifecycle";

export {
  buildCloudSessionMetadata,
  isCloudPushCandidate,
} from "./org2CloudSessionSync.metadata";
export type { Org2CloudSyncClientDeps } from "./org2CloudSessionSync.types";

const log = createLogger("Org2CloudSyncEngine");

/** Largest cursor accepted by the backend's int4 `p_after_seq` argument. */
const HEAD_READ_AFTER_SEQ = 2_147_483_647;

/**
 * Owns one session's metadata/event push plane, including persisted cursors,
 * event-clean stamps, OCC re-anchors, and retract bookkeeping.
 *
 * In-memory bookkeeping (pushed-metadata hashes, clean-event-plane stamps,
 * cursor/pushed-marker storage) lives in the Org2CloudSessionSyncState base
 * class in org2CloudSessionSync.state.ts; this subclass adds the
 * network-facing push/rewrite orchestration that calls the sync client.
 */
export class Org2CloudSessionSync extends Org2CloudSessionSyncState {
  constructor(
    getStore: () => CloudStore | null,
    private readonly client: Org2CloudSyncClientDeps
  ) {
    super(getStore);
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
