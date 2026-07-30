// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetSyncJournalForTests } from "@src/features/Org2Cloud/org2CloudSyncJournal";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import type { CloudOrgSyncStatus } from "./useCloudOrgSyncStatus";
import { useCloudOrgSyncStatus } from "./useCloudOrgSyncStatus";

const mocks = vi.hoisted(() => ({
  runSyncPassAndWaitForDrain: vi.fn<() => Promise<void>>(),
  schemaVersion: vi.fn<() => Promise<number | null>>(),
  getCloudCapabilities: vi.fn(),
  endpointForOrg: vi.fn(),
}));

vi.mock("@src/features/Org2Cloud/org2CloudSyncEngine", () => ({
  org2CloudSyncEngine: {
    runSyncPassAndWaitForDrain: mocks.runSyncPassAndWaitForDrain,
  },
}));

vi.mock("@src/features/Org2Cloud/org2CloudClient", () => ({
  schemaVersion: mocks.schemaVersion,
}));

vi.mock("@src/features/Org2Cloud/org2CloudCapabilities", () => ({
  getCloudCapabilities: mocks.getCloudCapabilities,
}));

vi.mock("@src/features/Org2Cloud/org2CloudOrgEndpointRouter", () => ({
  endpointForOrg: mocks.endpointForOrg,
}));

function mountStatus(): {
  read: () => CloudOrgSyncStatus;
  root: ReturnType<typeof createSmokeRoot>;
  mount: () => Promise<void>;
} {
  // Append rather than reassign: every render records its status object and
  // `read()` takes the newest one.
  const readings: CloudOrgSyncStatus[] = [];
  function Probe() {
    readings.push(useCloudOrgSyncStatus("org-1"));
    return null;
  }
  const root = createSmokeRoot();
  return {
    root,
    mount: () => root.render(createElement(Probe)),
    read: () => {
      const latest = readings[readings.length - 1];
      if (!latest) throw new Error("probe not mounted");
      return latest;
    },
  };
}

beforeEach(() => {
  resetSyncJournalForTests();
  mocks.runSyncPassAndWaitForDrain.mockReset();
  mocks.runSyncPassAndWaitForDrain.mockResolvedValue(undefined);
  mocks.schemaVersion.mockReset();
  mocks.schemaVersion.mockResolvedValue(1);
  mocks.getCloudCapabilities.mockReset();
  mocks.getCloudCapabilities.mockResolvedValue({
    broadcastSignals: true,
    storageSegments: true,
    homeEndpoints: false,
    teamInboxMentions: false,
    memberRuntime: true,
  });
  mocks.endpointForOrg.mockReset();
  mocks.endpointForOrg.mockReturnValue({
    webOrigin: "https://app.example.com",
    supabaseUrl: "https://db.example.com/",
    anonKey: "super-secret-anon-key",
    isOfficial: true,
  });
});

afterEach(() => {
  resetSyncJournalForTests();
});

describe("useCloudOrgSyncStatus", () => {
  it("exposes the endpoint origin only, never the anon key", async () => {
    const probe = mountStatus();
    try {
      await probe.mount();
      expect(probe.read().endpointOrigin).toBe("https://db.example.com");
      expect(JSON.stringify(probe.read())).not.toContain(
        "super-secret-anon-key"
      );
    } finally {
      await probe.root.unmount();
    }
  });

  it("probes the schema version once on mount and reports a match", async () => {
    const probe = mountStatus();
    try {
      await probe.mount();
      expect(mocks.schemaVersion).toHaveBeenCalledTimes(1);
      expect(probe.read().schemaStatus).toBe("matched");
      expect(probe.read().backendSchemaVersion).toBe(1);
    } finally {
      await probe.root.unmount();
    }
  });

  it("reports a mismatch when the backend answers a different version", async () => {
    mocks.schemaVersion.mockResolvedValue(7);
    const probe = mountStatus();
    try {
      await probe.mount();
      expect(probe.read().schemaStatus).toBe("mismatched");
      expect(probe.read().backendSchemaVersion).toBe(7);
    } finally {
      await probe.root.unmount();
    }
  });

  it("reports unknown when the probe answers null or rejects", async () => {
    mocks.schemaVersion.mockResolvedValue(null);
    const nullProbe = mountStatus();
    try {
      await nullProbe.mount();
      expect(nullProbe.read().schemaStatus).toBe("unknown");
    } finally {
      await nullProbe.root.unmount();
    }

    mocks.schemaVersion.mockRejectedValue(new Error("offline"));
    const rejectedProbe = mountStatus();
    try {
      await rejectedProbe.mount();
      expect(rejectedProbe.read().schemaStatus).toBe("unknown");
    } finally {
      await rejectedProbe.root.unmount();
    }
  });

  it("stays signed out and skips the capability probe without a token", async () => {
    const probe = mountStatus();
    try {
      await probe.mount();
      expect(probe.read().signedIn).toBe(false);
      expect(probe.read().userId).toBeNull();
      expect(probe.read().tokenExpiresAtMs).toBeNull();
      expect(probe.read().capabilities).toBeNull();
      expect(probe.read().capabilitiesLoading).toBe(false);
      expect(mocks.getCloudCapabilities).not.toHaveBeenCalled();
    } finally {
      await probe.root.unmount();
    }
  });

  it("runs the engine's drain-waiting pass and reports success", async () => {
    const probe = mountStatus();
    try {
      await probe.mount();
      await dispatch(() => probe.read().runSync());
      expect(mocks.runSyncPassAndWaitForDrain).toHaveBeenCalledTimes(1);
      expect(probe.read().running).toBe(false);
      expect(probe.read().runSucceeded).toBe(true);
      expect(probe.read().runError).toBeNull();
    } finally {
      await probe.root.unmount();
    }
  });

  it("swallows an engine rejection into runError instead of throwing", async () => {
    mocks.runSyncPassAndWaitForDrain.mockRejectedValue(
      Object.assign(new Error("quota gone"), { code: "ORG2_QUOTA_EXCEEDED" })
    );
    const probe = mountStatus();
    try {
      await probe.mount();
      await dispatch(() => {
        expect(() => probe.read().runSync()).not.toThrow();
      });
      expect(mocks.runSyncPassAndWaitForDrain).toHaveBeenCalledTimes(1);
      expect(probe.read().running).toBe(false);
      expect(probe.read().runSucceeded).toBe(false);
      expect(probe.read().runError).toBe("quota gone");
    } finally {
      await probe.root.unmount();
    }
  });
});
