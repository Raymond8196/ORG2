/**
 * Clip-model semantics tests for the subagent monitor data source.
 *
 * Regression coverage for the "Monitoring N subagents accumulates forever"
 * bug: clips must close when the backend reports a terminal session, and
 * cursor filtering must drop cells once the cursor passes a clip's end.
 */
import { describe, expect, it } from "vitest";

import {
  type ChildSessionRecord,
  SUBAGENT_ACTIVE_LEAD_MS,
  type SubagentSession,
  isActiveAtTimestamp,
  mapChildSessionRecord,
} from "../useSubagentSessions";

const T0 = new Date("2026-06-12T10:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

function makeRecord(
  overrides: Partial<ChildSessionRecord> = {}
): ChildSessionRecord {
  return {
    sessionId: "sdeagent-child-1",
    name: "Explore (Audit backend workspace core)",
    status: "running",
    createdAt: "2026-06-12T10:00:00Z",
    updatedAt: "2026-06-12T10:30:00Z",
    sessionType: "subagent",
    parentSessionId: "sdeagent-parent",
    parentEventId: null,
    isTerminal: false,
    endedAt: null,
    ...overrides,
  };
}

describe("mapChildSessionRecord", () => {
  it("keeps the clip open for a running session", () => {
    const sub = mapChildSessionRecord(makeRecord(), T0 + HOUR);
    expect(sub.endedAtMs).toBeNull();
    expect(sub.isTerminal).toBe(false);
    expect(sub.status).toBe("running");
  });

  it("closes the clip at backend endedAt for a terminal session", () => {
    const sub = mapChildSessionRecord(
      makeRecord({
        status: "completed",
        isTerminal: true,
        endedAt: "2026-06-12T10:20:00Z",
      }),
      T0 + HOUR
    );
    expect(sub.endedAtMs).toBe(new Date("2026-06-12T10:20:00Z").getTime());
    expect(sub.isTerminal).toBe(true);
    expect(sub.status).toBe("completed");
  });

  it("closes the clip for a cancelled session (the 16-stack regression)", () => {
    // Pre-fix, "cancelled" fell into the frontend pending bucket →
    // endedAtMs null → cell stacked forever.
    const sub = mapChildSessionRecord(
      makeRecord({
        status: "cancelled",
        isTerminal: true,
        endedAt: "2026-06-12T10:10:00Z",
      }),
      T0 + HOUR
    );
    expect(sub.endedAtMs).not.toBeNull();
    expect(sub.status).toBe("failed");
  });

  it("does not guess terminal-ness from the status string", () => {
    // Backend is authoritative: even a status that LOOKS terminal stays
    // open unless isTerminal says so (fresh row mid-transition).
    const sub = mapChildSessionRecord(
      makeRecord({ status: "failed", isTerminal: false, endedAt: null }),
      T0 + HOUR
    );
    expect(sub.endedAtMs).toBeNull();
  });

  it("zombie fuse closes non-terminal rows stale for >24h", () => {
    const sub = mapChildSessionRecord(
      makeRecord({ status: "running" }),
      T0 + 26 * HOUR
    );
    expect(sub.endedAtMs).toBe(new Date("2026-06-12T10:30:00Z").getTime());
  });

  it("zombie fuse leaves recent non-terminal rows open", () => {
    const sub = mapChildSessionRecord(
      makeRecord({ status: "running" }),
      T0 + 2 * HOUR
    );
    expect(sub.endedAtMs).toBeNull();
  });
});

describe("isActiveAtTimestamp", () => {
  const closedClip: SubagentSession = {
    ...mapChildSessionRecord(
      makeRecord({
        status: "completed",
        isTerminal: true,
        endedAt: "2026-06-12T10:20:00Z",
      }),
      T0 + HOUR
    ),
  };

  it("is inactive before the lead window starts", () => {
    expect(
      isActiveAtTimestamp(closedClip, T0 - SUBAGENT_ACTIVE_LEAD_MS - 1)
    ).toBe(false);
  });

  it("is active during the pre-start lead window", () => {
    expect(isActiveAtTimestamp(closedClip, T0 - 1)).toBe(true);
  });

  it("is active inside the clip window", () => {
    expect(isActiveAtTimestamp(closedClip, T0 + 10 * 60 * 1000)).toBe(true);
  });

  it("retires once the cursor passes the clip end", () => {
    expect(isActiveAtTimestamp(closedClip, T0 + 21 * 60 * 1000)).toBe(false);
  });

  it("open clips stay active for any cursor after start", () => {
    const openClip = mapChildSessionRecord(makeRecord(), T0 + HOUR);
    expect(isActiveAtTimestamp(openClip, T0 + 100 * HOUR)).toBe(true);
  });
});
