import { describe, expect, it, vi } from "vitest";

import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  offlineSyncRowFingerprint,
  pickOfflineSyncCandidates,
} from "./org2CloudOfflineSync";

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {},
}));
vi.mock("@src/api/tauri/lineage", () => ({
  indexOrgtrackCollaborationSession: vi.fn(),
}));

const ORG = "0aefaa1f-de59-4fbe-a4e5-57cbe6c2bbdd";
const ENDPOINT = "https://cloud.example";
const SELF = "viewer-user";

function row(
  overrides: Partial<RemoteTeammateSessionMetadata> = {}
): RemoteTeammateSessionMetadata {
  return {
    id: `${ORG}:owner-1:sess-1`,
    orgId: ORG,
    ownerUserId: "owner-1",
    sourceSessionId: "sess-1",
    title: "T",
    eventsEpoch: 2,
    eventsFrozenSeq: 3,
    eventsCount: 40,
    eventsTailHash: "tail",
    lastActivityAt: "2026-07-30T01:00:00Z",
    ...overrides,
  } as RemoteTeammateSessionMetadata;
}

function pick(
  rows: RemoteTeammateSessionMetadata[],
  overrides: Partial<Parameters<typeof pickOfflineSyncCandidates>[0]> = {}
) {
  return pickOfflineSyncCandidates({
    rows,
    sessions: [],
    orgId: ORG,
    sourceEndpointUrl: ENDPOINT,
    selfUserId: SELF,
    busyRowIds: new Set(),
    pausedRowIds: new Set(),
    unsubscribedRowIds: new Set(),
    attempted: new Map(),
    ...overrides,
  });
}

describe("pickOfflineSyncCandidates", () => {
  it("keeps replayable teammate rows, newest activity first", () => {
    const older = row({
      id: `${ORG}:owner-1:sess-old`,
      sourceSessionId: "sess-old",
      lastActivityAt: "2026-07-29T01:00:00Z",
    });
    const newer = row();
    expect(pick([older, newer]).map((r) => r.sourceSessionId)).toEqual([
      "sess-1",
      "sess-old",
    ]);
  });

  it("skips metadata-only, deleted, own, busy, and attempted rows", () => {
    const metadataOnly = row({
      id: `${ORG}:owner-1:m`,
      sourceSessionId: "m",
      eventsEpoch: undefined,
    });
    const deleted = row({
      id: `${ORG}:owner-1:d`,
      sourceSessionId: "d",
      deletedAt: "2026-07-30T00:00:00Z",
    });
    const own = row({
      id: `${ORG}:${SELF}:o`,
      sourceSessionId: "o",
      ownerUserId: SELF,
    });
    const busy = row({ id: `${ORG}:owner-1:b`, sourceSessionId: "b" });
    const attempted = row({ id: `${ORG}:owner-1:a`, sourceSessionId: "a" });
    const fresh = row();

    const result = pick([metadataOnly, deleted, own, busy, attempted, fresh], {
      busyRowIds: new Set([busy.id]),
      attempted: new Map([
        [attempted.id, offlineSyncRowFingerprint(attempted)],
      ]),
    });
    expect(result.map((r) => r.sourceSessionId)).toEqual(["sess-1"]);
  });

  it("never restarts a user-paused download on its own", () => {
    const paused = row({ id: `${ORG}:owner-1:p`, sourceSessionId: "p" });
    const fresh = row();
    const result = pick([paused, fresh], {
      pausedRowIds: new Set([paused.id]),
    });
    expect(result.map((r) => r.sourceSessionId)).toEqual(["sess-1"]);
  });

  it("never re-imports a row the user removed (unsubscribed)", () => {
    const removed = row({ id: `${ORG}:owner-1:r`, sourceSessionId: "r" });
    const fresh = row();
    const result = pick([removed, fresh], {
      unsubscribedRowIds: new Set([removed.id]),
    });
    expect(result.map((r) => r.sourceSessionId)).toEqual(["sess-1"]);
  });

  it("re-picks an attempted row once its remote state changes", () => {
    const target = row();
    const staleFingerprint = offlineSyncRowFingerprint({
      ...target,
      eventsCount: 39,
    } as RemoteTeammateSessionMetadata);
    const result = pick([target], {
      attempted: new Map([[target.id, staleFingerprint]]),
    });
    expect(result).toHaveLength(1);
  });

  it("skips rows whose local imported cursor already matches", () => {
    const target = row();
    const imported = {
      session_id: "imported-session-x",
      importedFrom: {
        orgId: ORG,
        sourceSessionId: target.sourceSessionId,
        sourceEndpointUrl: ENDPOINT,
        epoch: 2,
        seq: 3,
        count: 40,
        tailHash: "tail",
      },
    } as unknown as Session;
    expect(pick([target], { sessions: [imported] })).toHaveLength(0);
    // Stale cursor (owner pushed more) => candidate again.
    const grown = row({ eventsCount: 55 });
    expect(pick([grown], { sessions: [imported] })).toHaveLength(1);
  });
});
