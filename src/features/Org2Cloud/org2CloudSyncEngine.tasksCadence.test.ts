import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupEngineFixture,
  createEngineFixture,
  documentStub,
  engineTestDeps,
  makeTask,
  messageMock,
  notifySessionEvents,
} from "./org2CloudSyncEngine.testUtils";
import type {
  EngineFixture,
  ListCommentTasksResult,
} from "./org2CloudSyncEngine.testUtils";

const {
  HIDDEN_PASS_INTERVAL_MS,
  PASS_INTERVAL_MS,
  org2CloudCommentTaskCursorsAtom,
  org2CloudCommentTasksAtom,
  org2CloudOrgsAtom,
  Org2CloudSyncError,
  Org2CloudTaskError,
} = engineTestDeps;

describe("Org2CloudSyncEngine comment tasks and cadence", () => {
  let fixture: EngineFixture;
  let store: EngineFixture["store"];
  let client: EngineFixture["client"];
  let tasksClient: EngineFixture["tasksClient"];
  let engine: EngineFixture["engine"];

  beforeEach(() => {
    fixture = createEngineFixture();
    ({ store, client, tasksClient, engine } = fixture);
  });

  afterEach(() => {
    cleanupEngineFixture(engine);
  });

  it("pulls comment tasks full-then-delta behind the persisted overlap cursor", async () => {
    const task = makeTask("task-1");
    tasksClient.listCommentTasks.mockResolvedValue({
      serverTime: "2026-07-01T12:00:00.000Z",
      tasks: [task],
    });
    await engine.runSyncPass();

    // First pass bypasses the cursor (complete listing, cursor=null) …
    expect(tasksClient.listCommentTasks).toHaveBeenCalledWith(
      "jwt-1",
      "corg-1",
      null
    );
    expect(store.get(org2CloudCommentTasksAtom)).toEqual({
      "corg-1": { "task-1": task },
    });
    // … and persists serverTime minus the 2s safety overlap …
    expect(store.get(org2CloudCommentTaskCursorsAtom)).toEqual({
      "corg-1": "2026-07-01T11:59:58.000Z",
    });

    // … so the SECOND pass pulls the delta behind it.
    const afterFull = store.get(org2CloudCommentTasksAtom);
    tasksClient.listCommentTasks.mockResolvedValue({
      serverTime: "2026-07-01T12:01:00.000Z",
      tasks: [],
    });
    // Inbound planes run at most once per INBOUND_FALLBACK_INTERVAL_MS per
    // pass cycle (realtime is the primary trigger); hop the clock past the
    // window so this pass includes the inbound pull.
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await engine.runSyncPass();
    expect(tasksClient.listCommentTasks).toHaveBeenLastCalledWith(
      "jwt-1",
      "corg-1",
      "2026-07-01T11:59:58.000Z"
    );
    // An empty delta never churns the atom (identity-stable merge) even
    // though the cursor still advances.
    expect(store.get(org2CloudCommentTasksAtom)).toBe(afterFull);
    expect(store.get(org2CloudCommentTaskCursorsAtom)).toEqual({
      "corg-1": "2026-07-01T12:00:58.000Z",
    });
  });

  it("LWW-merges deltas: an overlap re-delivery never clobbers a fresher write-through", async () => {
    const initial = makeTask("task-1", {
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    tasksClient.listCommentTasks.mockResolvedValueOnce({
      serverTime: "2026-07-01T12:00:00.000Z",
      tasks: [initial],
    });
    await engine.runSyncPass(); // full listing seeds the map

    // A claim response write-through between passes holds a NEWER copy …
    const claimed = makeTask("task-1", {
      state: "claimed",
      claimedByUserId: "user-2",
      updatedAt: "2026-07-01T12:00:05.000Z",
    });
    store.set(org2CloudCommentTasksAtom, {
      "corg-1": { "task-1": claimed },
    });
    // … while the 2s overlap re-delivers the OLDER open row next to a new
    // task the delta genuinely carries.
    const fresh = makeTask("task-2", { updatedAt: "2026-07-01T12:00:03.000Z" });
    tasksClient.listCommentTasks.mockResolvedValueOnce({
      serverTime: "2026-07-01T12:01:00.000Z",
      tasks: [initial, fresh],
    });
    // Inbound planes run at most once per INBOUND_FALLBACK_INTERVAL_MS per
    // pass cycle (realtime is the primary trigger); hop the clock past the
    // window so this pass includes the inbound pull.
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await engine.runSyncPass();

    expect(store.get(org2CloudCommentTasksAtom)).toEqual({
      "corg-1": { "task-1": claimed, "task-2": fresh },
    });
  });

  it("isolates a failing org's task pull: others merge, no backoff for member errors", async () => {
    store.set(org2CloudOrgsAtom, [
      { orgId: "corg-1", name: "Cloud Team", role: "member" },
      { orgId: "corg-2", name: "Other Team", role: "member" },
    ]);
    const task = makeTask("task-2");
    tasksClient.listCommentTasks.mockImplementation(
      async (_token: string, orgId: string, _since: string | null) => {
        if (orgId === "corg-1") {
          throw new Org2CloudTaskError("ORG2_MEMBER_REQUIRED", 403);
        }
        return { serverTime: "2026-07-01T12:00:00.000Z", tasks: [task] };
      }
    );
    await engine.runSyncPass();

    // corg-2 merged + cursor-advanced; corg-1 neither.
    expect(store.get(org2CloudCommentTasksAtom)).toEqual({
      "corg-2": { "task-2": task },
    });
    expect(store.get(org2CloudCommentTaskCursorsAtom)).toEqual({
      "corg-2": "2026-07-01T11:59:58.000Z",
    });
    // A membership/org error is NOT an org-level backoff (0002 rule: the
    // listing can never raise quota/disabled): no toast, and the next pass
    // retries corg-1 — still as a FULL listing (the latch only sets on
    // success).
    expect(messageMock.warning).not.toHaveBeenCalled();
    // Inbound planes run at most once per INBOUND_FALLBACK_INTERVAL_MS per
    // pass cycle (realtime is the primary trigger); hop the clock past the
    // window so this pass includes the inbound pull.
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await engine.runSyncPass();
    const corg1Calls = tasksClient.listCommentTasks.mock.calls.filter(
      ([, orgId]) => orgId === "corg-1"
    );
    expect(corg1Calls).toHaveLength(2);
    expect(corg1Calls[1][2]).toBeNull();
  });

  it("skips the task pull for an org backed off by the session plane", async () => {
    client.rewriteSessionEvents.mockRejectedValue(
      new Org2CloudSyncError("ORG2_QUOTA_EXCEEDED", 403)
    );
    await engine.runSyncPass();
    expect(tasksClient.listCommentTasks).not.toHaveBeenCalled();
  });

  it("aborts the task merge when stop() lands mid-listing (generation check)", async () => {
    let resolveList!: (value: ListCommentTasksResult) => void;
    const listCalled = new Promise<void>((markCalled) => {
      tasksClient.listCommentTasks.mockImplementation(() => {
        markCalled();
        return new Promise<ListCommentTasksResult>((resolve) => {
          resolveList = resolve;
        });
      });
    });

    const pass = engine.runSyncPass();
    await listCalled;
    engine.stop();
    resolveList({
      serverTime: "2026-07-01T12:00:00.000Z",
      tasks: [makeTask("task-1")],
    });
    await pass;

    // Neither the map nor the cursor was written after the generation bump.
    expect(store.get(org2CloudCommentTasksAtom)).toEqual({});
    expect(store.get(org2CloudCommentTaskCursorsAtom)).toEqual({});
  });

  // --- Visibility-aware cadence (user CPU constraint: ONE timer chain) ------

  describe("visibility-aware cadence", () => {
    afterEach(() => {
      documentStub.visibilityState = "visible";
    });

    it("stretches the chain to HIDDEN_PASS_INTERVAL_MS while hidden", async () => {
      documentStub.visibilityState = "hidden";
      const passSpy = vi.spyOn(engine, "runSyncPass");
      await vi.advanceTimersByTimeAsync(0); // start()'s initial 0ms pass
      expect(passSpy).toHaveBeenCalledTimes(1);
      // Settle the pass so its .finally reschedules before we advance.
      await passSpy.mock.results[0].value;

      // The 60s cadence is suspended …
      await vi.advanceTimersByTimeAsync(PASS_INTERVAL_MS);
      expect(passSpy).toHaveBeenCalledTimes(1);
      // … and the SAME chain fires at the 5-minute hidden cadence instead.
      await vi.advanceTimersByTimeAsync(
        HIDDEN_PASS_INTERVAL_MS - PASS_INTERVAL_MS
      );
      expect(passSpy).toHaveBeenCalledTimes(2);
    });

    it("snaps back with an immediate pass when the document becomes visible", async () => {
      documentStub.visibilityState = "hidden";
      const passSpy = vi.spyOn(engine, "runSyncPass");
      await vi.advanceTimersByTimeAsync(0);
      await passSpy.mock.results[0].value;
      expect(passSpy).toHaveBeenCalledTimes(1); // chain parked 5 minutes out

      documentStub.visibilityState = "visible";
      documentStub.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0); // the immediate setTimeout(0) pass
      expect(passSpy).toHaveBeenCalledTimes(2);
      await passSpy.mock.results[1].value;

      // The chain is back on the 60s cadence, not still parked at 5 minutes.
      await vi.advanceTimersByTimeAsync(PASS_INTERVAL_MS);
      expect(passSpy).toHaveBeenCalledTimes(3);
    });

    it("never lets event-store activity trigger passes while hidden (background agent case)", async () => {
      documentStub.visibilityState = "hidden";
      const passSpy = vi.spyOn(engine, "runSyncPass");
      await vi.advanceTimersByTimeAsync(0); // start()'s initial 0ms pass
      await passSpy.mock.results[0].value;
      expect(passSpy).toHaveBeenCalledTimes(1);

      // A steady stream of local event writes (an agent running while the
      // window is minimized) must not reintroduce the ~3s activity cadence:
      // the stretched 5-minute chain is the ONLY background schedule.
      notifySessionEvents("session-1");
      await vi.advanceTimersByTimeAsync(10_000);
      notifySessionEvents("session-1");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(passSpy).toHaveBeenCalledTimes(1);
    });

    it("drops a debounced activity pass when the document hides before it fires", async () => {
      const passSpy = vi.spyOn(engine, "runSyncPass");
      notifySessionEvents("session-1"); // visible: debounce armed
      documentStub.visibilityState = "hidden";
      await vi.advanceTimersByTimeAsync(5_000);
      // Only start()'s initial 0ms chain pass ran — the 3s debounce fired
      // into the hidden check and was dropped.
      expect(passSpy).toHaveBeenCalledTimes(1);
    });

    it("registers the listener on start and removes it on stop (leak-free)", () => {
      const addSpy = vi.spyOn(documentStub, "addEventListener");
      const removeSpy = vi.spyOn(documentStub, "removeEventListener");
      engine.stop(); // engine from beforeEach — restart under the spies
      engine.start(store);

      const added = addSpy.mock.calls.find(
        ([type]) => type === "visibilitychange"
      );
      expect(added).toBeDefined();

      engine.stop();
      // Removed with the SAME bound handler reference (no leak).
      expect(removeSpy).toHaveBeenCalledWith("visibilitychange", added![1]);

      // And a visibility flip after stop() schedules nothing.
      documentStub.dispatchEvent(new Event("visibilitychange"));
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
