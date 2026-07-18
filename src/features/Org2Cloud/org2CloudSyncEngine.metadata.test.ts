import { afterEach, describe, expect, it } from "vitest";

import { stableStringify } from "../TeamCollaboration/collabSyncUtils";
import { __FORK_RELAY_INTERNALS } from "../TeamCollaboration/forkSession";
import {
  buildCloudSessionMetadata,
  isCloudPushCandidate,
} from "./org2CloudSyncEngine";
import { SCOPE_KEY, SESSION } from "./org2CloudSyncEngine.testUtils";

describe("buildCloudSessionMetadata", () => {
  // The registry restore tests below seed the durable fork-relay registry;
  // this top-level describe has no store/engine hooks, so clean it here.
  afterEach(() => {
    localStorage.removeItem(__FORK_RELAY_INTERNALS.FORK_RELAY_STORAGE_KEY);
  });

  /** Valid registry forkedFrom — the entry parse is all-or-nothing. */
  const REGISTRY_FORKED_FROM = {
    orgId: "corg-1",
    sourceSessionId: "session-src",
    ownerMemberId: "m2",
    ownerDisplayName: "Bob",
    atCount: 2,
    forkedAt: "2026-07-02T00:00:00.000Z",
  };

  function buildMetadata() {
    return buildCloudSessionMetadata(
      SESSION,
      "corg-1",
      "user-1",
      "Me",
      SCOPE_KEY,
      { accessMode: "full_replay", visibility: "org" }
    );
  }

  it("mirrors the toRemoteMetadata shape with the cloud user as owner", () => {
    const metadata = buildCloudSessionMetadata(
      SESSION,
      "corg-1",
      "user-1",
      "Me",
      SCOPE_KEY,
      { accessMode: "full_replay", visibility: "org" }
    );
    expect(metadata.id).toBe("corg-1:user-1:session-1");
    expect(metadata.orgId).toBe("corg-1");
    expect(metadata.ownerMemberId).toBe("user-1");
    expect(metadata.repoScopeKey).toBe(SCOPE_KEY);
    expect(metadata.accessMode).toBe("full_replay");
    expect(metadata.replayLevel).toBe("replay");
    expect(metadata.visibility).toBe("org");
  });

  it("carries the ladder outcome onto the wire (metadata_only + restricted)", () => {
    const metadata = buildCloudSessionMetadata(
      SESSION,
      "corg-1",
      "user-1",
      "Me",
      SCOPE_KEY,
      { accessMode: "metadata_only", visibility: "restricted" }
    );
    expect(metadata.accessMode).toBe("metadata_only");
    expect(metadata.replayLevel).toBe("metadata");
    expect(metadata.visibility).toBe("restricted");
  });

  it("restores addressesComment from the fork-relay registry taskContext", () => {
    // `addressesComment` never exists on the Session row at all — the
    // registry taskContext is its only durable local home (agent-pickup
    // design §4), so EVERY push must restore it from there.
    localStorage.setItem(
      __FORK_RELAY_INTERNALS.FORK_RELAY_STORAGE_KEY,
      JSON.stringify({
        [SESSION.session_id]: {
          forkedFrom: REGISTRY_FORKED_FROM,
          handoffPending: false,
          taskContext: {
            orgId: "corg-1",
            sourceSessionId: "session-src",
            commentId: "comment-7",
            taskId: "task-7",
            excerpt: "please look at the failing push",
          },
        },
      })
    );

    const metadata = buildMetadata();

    expect(metadata.addressesComment).toEqual({
      commentId: "comment-7",
      sourceSessionId: "session-src",
    });
    // The same registry entry also restores the fork lineage on the wire.
    expect(metadata.forkedFrom).toMatchObject({
      sourceSessionId: "session-src",
    });
  });

  it("leaves addressesComment absent on the wire without a taskContext", () => {
    // A plain fork (pre-task registry shape): entry present, no taskContext.
    localStorage.setItem(
      __FORK_RELAY_INTERNALS.FORK_RELAY_STORAGE_KEY,
      JSON.stringify({
        [SESSION.session_id]: {
          forkedFrom: REGISTRY_FORKED_FROM,
          handoffPending: false,
        },
      })
    );

    const metadata = buildMetadata();

    expect(metadata.addressesComment).toBeUndefined();
    // No push churn: the metadata hash rides sha256(stableStringify(...)),
    // and stableStringify drops undefined keys — the serialized row is
    // byte-identical to one built by a pre-task client.
    expect(stableStringify(metadata)).not.toContain("addressesComment");
  });
});

describe("isCloudPushCandidate", () => {
  it("excludes only imported teammate copies; the user's own external history is shareable", () => {
    expect(isCloudPushCandidate(SESSION)).toBe(true);
    // Imported teammate copy (pulled from the cloud) — excluded (echo-loop).
    expect(
      isCloudPushCandidate({
        ...SESSION,
        importedFrom: { orgId: "x" } as never,
      })
    ).toBe(false);
    // The user's OWN external history (no importedFrom) is now shareable.
    expect(
      isCloudPushCandidate({ ...SESSION, category: "external_history" })
    ).toBe(true);
    // External history that is ALSO an imported copy stays excluded.
    expect(
      isCloudPushCandidate({
        ...SESSION,
        category: "external_history",
        importedFrom: { orgId: "x" } as never,
      })
    ).toBe(false);
  });
});
