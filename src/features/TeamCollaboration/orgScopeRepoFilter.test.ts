import { describe, expect, it, vi } from "vitest";

import { repoMatchesOrgScopes } from "./orgScopeRepoFilter";

const SCOPES = ["github.com/yorgai/org2"];

describe("repoMatchesOrgScopes", () => {
  it("matches a repo whose remote url is in scope", () => {
    expect(
      repoMatchesOrgScopes(
        { repo_url: "https://github.com/yorgai/ORG2.git" },
        SCOPES
      )
    ).toBe(true);
  });

  it("rejects a repo whose remote url is out of scope", () => {
    expect(
      repoMatchesOrgScopes(
        { repo_url: "https://github.com/acme/elsewhere.git" },
        SCOPES
      )
    ).toBe(false);
  });

  it("resolves local checkouts through the peek cache", () => {
    expect(
      repoMatchesOrgScopes(
        { fs_uri: "/Users/me/org2" },
        SCOPES,
        () => "github.com/yorgai/org2"
      )
    ).toBe(true);
  });

  it("hides unresolved local checkouts and primes resolution", () => {
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
  });

  it("rejects remote-less repos and empty scopes", () => {
    expect(repoMatchesOrgScopes({ fs_uri: "/x" }, SCOPES, () => null)).toBe(
      false
    );
    expect(
      repoMatchesOrgScopes({ repo_url: "https://github.com/yorgai/ORG2" }, [])
    ).toBe(false);
    expect(
      repoMatchesOrgScopes(
        { repo_url: "https://github.com/yorgai/ORG2" },
        undefined
      )
    ).toBe(false);
  });
});
