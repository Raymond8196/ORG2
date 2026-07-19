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
import {
  getSessionForkedFrom,
  getSessionTaskContext,
} from "../TeamCollaboration/forkSession";
import { computeSegmentHash } from "../TeamCollaboration/sync/collabGzip";
import type { CloudPushAccess } from "./org2CloudAccessSettings";
import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import type { CollabSessionPushCursor } from "./org2CloudSyncAtoms";
import {
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
} from "./org2CloudSyncAtoms";
import * as org2CloudSyncClient from "./org2CloudSyncClient";
import { isOrg2SyncErrorCode } from "./org2CloudSyncClient";
import type { CloudStore } from "./org2CloudSyncLifecycle";

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

/**
 * Build the cloud metadata through the same collaboration wire shape used by
 * self-hosted sync, restoring fork/task lineage stripped from Session rows.
 */
export function buildCloudSessionMetadata(
  session: Session,
  orgId: string,
  userId: string,
  displayName: string,
  scopeKey: string | null,
  access: CloudPushAccess
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
  const taskContext = getSessionTaskContext(session);
  return toRemoteMetadata(
    withLineage,
    org,
    member,
    settings,
    scopeKey,
    taskContext
      ? {
          commentId: taskContext.commentId,
          sourceSessionId: taskContext.sourceSessionId,
        }
      : undefined
  );
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
  private readonly cleanEventPlanes = new Map<string, Map<string, number>>();
  /** Session activity stamp prevents a mid-push write from being marked clean. */
  private readonly eventActivityStamps = new Map<string, number>();
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
    this.passPushPrepareCache.clear();
  }

  /** Start a new engine pass; prepared events must never leak across passes. */
  beginPass(): void {
    this.passPushPrepareCache.clear();
  }

  /** Drop clean markers and stamp a local event-store write. */
  noteSessionEventActivity(sessionId: string): void {
    this.eventActivityStamps.set(
      sessionId,
      (this.eventActivityStamps.get(sessionId) ?? 0) + 1
    );
    this.cleanEventPlanes.delete(sessionId);
  }

  private isEventPlaneClean(orgId: string, sessionId: string): boolean {
    const cleanAt = this.cleanEventPlanes.get(sessionId)?.get(orgId);
    return cleanAt !== undefined && Date.now() - cleanAt < EVENTS_CLEAN_TTL_MS;
  }

  private markEventPlaneClean(
    orgId: string,
    sessionId: string,
    stampAtRead: number
  ): void {
    if ((this.eventActivityStamps.get(sessionId) ?? 0) !== stampAtRead) return;
    let byOrg = this.cleanEventPlanes.get(sessionId);
    if (!byOrg) {
      byOrg = new Map();
      this.cleanEventPlanes.set(sessionId, byOrg);
    }
    byOrg.set(orgId, Date.now());
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
    this.getStore()?.set(org2CloudPushedMetadataAtom, (current) => ({
      ...current,
      [`${orgId}:${sessionId}`]: true,
    }));
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
      access
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
    if (this.isEventPlaneClean(orgId, sessionId)) {
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
      this.markEventPlaneClean(orgId, sessionId, stampAtRead);
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
          this.markEventPlaneClean(orgId, sessionId, stampAtRead);
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
          this.markEventPlaneClean(orgId, sessionId, stampAtRead);
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
          this.markEventPlaneClean(orgId, sessionId, stampAtRead);
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
      this.markEventPlaneClean(orgId, sessionId, stampAtRead);
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
    this.markEventPlaneClean(orgId, sessionId, stampAtRead);
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
