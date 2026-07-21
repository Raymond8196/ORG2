import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Org2CloudAuthState } from "./org2CloudAuthAtom";
import { ensureFreshSession, listOrgMembers } from "./org2CloudClient";
import {
  clearCloudOrgMembersCache,
  loadCloudOrgMembers,
} from "./org2CloudMembersCoordinator";

vi.mock("./org2CloudClient", () => ({
  ensureFreshSession: vi.fn(),
  listOrgMembers: vi.fn(),
}));

const ensureFreshSessionMock = vi.mocked(ensureFreshSession);
const listOrgMembersMock = vi.mocked(listOrgMembers);

function auth(userId = "user-1"): Org2CloudAuthState {
  return {
    kind: "org2_cloud",
    supabaseUrl: "https://cloud.example.com",
    supabaseAnonKey: "anon",
    userId,
    accessToken: `token-${userId}`,
    refreshToken: `refresh-${userId}`,
    expiresAt: 9999999999,
  };
}

beforeEach(() => {
  clearCloudOrgMembersCache();
  vi.clearAllMocks();
  ensureFreshSessionMock.mockImplementation(async (current) => current);
  listOrgMembersMock.mockResolvedValue([
    {
      userId: "member-1",
      displayName: "Ada",
      role: "member",
      status: "active",
    },
  ]);
});

describe("loadCloudOrgMembers", () => {
  it("coalesces concurrent consumers and reuses the fresh cache", async () => {
    const current = auth();
    const [first, second] = await Promise.all([
      loadCloudOrgMembers(current, "org-1"),
      loadCloudOrgMembers(current, "org-1"),
    ]);

    expect(first?.members).toEqual(second?.members);
    await loadCloudOrgMembers(current, "org-1");
    expect(listOrgMembersMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after a realtime roster version bump", async () => {
    const current = auth();
    await loadCloudOrgMembers(current, "org-1", 3);
    await loadCloudOrgMembers(current, "org-1", 4);
    expect(listOrgMembersMock).toHaveBeenCalledTimes(2);
  });

  it("never shares a roster cache across cloud identities", async () => {
    await loadCloudOrgMembers(auth("user-1"), "org-1");
    await loadCloudOrgMembers(auth("user-2"), "org-1");
    expect(listOrgMembersMock).toHaveBeenCalledTimes(2);
  });
});
