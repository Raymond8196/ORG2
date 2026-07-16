import { describe, expect, it, vi } from "vitest";

import {
  repoEligibleForOrgScopedPicker,
  repoMatchesOrgScopes,
} from "./orgScopeRepoFilter";

const SCOPES = ["github.com/yorgai/org2"];

describe("repoMatchesOrgScopes (strict)", () => {
  it("matches a repo whose remote url is in scope", () => {
    expect(
      repoMatchesOrgScopes(
        { repo_url: "https://github.com/yorgai/ORG2.git" },
        SCOPES
      )
    ).toBe(true);
  });

  it("matches a fork checkout through ANY remote key (upstream)", () => {
    expect(
      repoMatchesOrgScopes({ fs_uri: "/Users/me/org2-fork" }, SCOPES, () => [
        "github.com/vantanode/org2",
        "github.com/yorgai/org2",
      ])
    ).toBe(true);
  });

  it("rejects out-of-scope, unresolved, and remote-less repos", () => {
    expect(
      repoMatchesOrgScopes(
        { repo_url: "https://github.com/acme/elsewhere.git" },
        SCOPES
      )
    ).toBe(false);
    const prime = vi.fn();
    expect(
      repoMatchesOrgScopes(
        { fs_uri: "/Users/me/org2" },
        SCOPES,
        () => undefined,
        prime
      )
    ).toBe(false);
    expect(prime).toHaveBeenCalledWith("/Users/me/org2");
    expect(repoMatchesOrgScopes({ fs_uri: "/x" }, SCOPES, () => null)).toBe(
      false
    );
  });
});

describe("repoEligibleForOrgScopedPicker (optimistic)", () => {
  it("keeps a still-resolving checkout visible and primes it", () => {
    const prime = vi.fn();
    expect(
      repoEligibleForOrgScopedPicker(
        { fs_uri: "/Users/me/org2" },
        SCOPES,
        () => undefined,
        prime
      )
    ).toBe(true);
    expect(prime).toHaveBeenCalledWith("/Users/me/org2");
  });

  it("hides a resolved out-of-scope or remote-less checkout", () => {
    expect(
      repoEligibleForOrgScopedPicker(
        { fs_uri: "/Users/me/other" },
        SCOPES,
        () => ["github.com/acme/elsewhere"]
      )
    ).toBe(false);
    expect(
      repoEligibleForOrgScopedPicker({ fs_uri: "/x" }, SCOPES, () => null)
    ).toBe(false);
  });

  it("matches through any remote key like the strict variant", () => {
    expect(
      repoEligibleForOrgScopedPicker(
        { fs_uri: "/Users/me/org2-fork" },
        SCOPES,
        () => ["github.com/vantanode/org2", "github.com/yorgai/org2"]
      )
    ).toBe(true);
  });

  it("rejects everything for empty scopes", () => {
    expect(
      repoEligibleForOrgScopedPicker(
        { repo_url: "https://github.com/yorgai/ORG2" },
        []
      )
    ).toBe(false);
  });
});
