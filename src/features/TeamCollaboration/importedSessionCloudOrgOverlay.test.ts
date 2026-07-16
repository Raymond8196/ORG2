import { describe, expect, it, vi } from "vitest";

import { resolveImportedSessionCloudOrgId } from "./importedSessionCloudOrgOverlay";

const CONTEXT = {
  memberOrgIds: ["org-a", "org-b"],
  scopesByOrg: {
    "org-a": ["github.com/yorgai/org2"],
    "org-b": ["github.com/yorgai/other"],
  },
};

describe("resolveImportedSessionCloudOrgId", () => {
  it("adopts a repo covered by exactly one org scope", () => {
    const orgId = resolveImportedSessionCloudOrgId("/Users/me/org2", {
      ...CONTEXT,
      peekKeys: () => ["github.com/yorgai/org2"],
    });
    expect(orgId).toBe("org-a");
  });

  it("stays personal when multiple org scopes cover the repo", () => {
    const orgId = resolveImportedSessionCloudOrgId("/Users/me/org2", {
      memberOrgIds: ["org-a", "org-b"],
      scopesByOrg: {
        "org-a": ["github.com/yorgai/org2"],
        "org-b": ["github.com/yorgai/org2"],
      },
      peekKeys: () => ["github.com/yorgai/org2"],
    });
    expect(orgId).toBeNull();
  });

  it("stays personal when no scope matches", () => {
    const orgId = resolveImportedSessionCloudOrgId("/Users/me/elsewhere", {
      ...CONTEXT,
      peekKeys: () => ["github.com/acme/elsewhere"],
    });
    expect(orgId).toBeNull();
  });

  it("primes unresolved paths and defers adoption", () => {
    const prime = vi.fn();
    const orgId = resolveImportedSessionCloudOrgId("/Users/me/org2", {
      ...CONTEXT,
      peekKeys: () => undefined,
      prime,
    });
    expect(orgId).toBeNull();
    expect(prime).toHaveBeenCalledWith("/Users/me/org2");
  });

  it("skips repo-less and remote-less sessions", () => {
    expect(
      resolveImportedSessionCloudOrgId(null, {
        ...CONTEXT,
        peekKeys: () => ["github.com/yorgai/org2"],
      })
    ).toBeNull();
    expect(
      resolveImportedSessionCloudOrgId("/Users/me/no-remote", {
        ...CONTEXT,
        peekKeys: () => null,
      })
    ).toBeNull();
  });

  it("ignores scopes of orgs the user is not a member of", () => {
    const orgId = resolveImportedSessionCloudOrgId("/Users/me/org2", {
      memberOrgIds: ["org-b"],
      scopesByOrg: CONTEXT.scopesByOrg,
      peekKeys: () => ["github.com/yorgai/org2"],
    });
    expect(orgId).toBeNull();
  });
});
