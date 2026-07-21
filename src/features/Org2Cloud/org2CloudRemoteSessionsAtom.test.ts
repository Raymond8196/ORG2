import { describe, expect, it } from "vitest";

import {
  type CloudOrgRemoteSessionsEntry,
  beginRemoteSessionsFetch,
  remoteSessionsEntryForIdentity,
} from "./org2CloudRemoteSessionsAtom";

function readyEntry(identityKey: string): CloudOrgRemoteSessionsEntry {
  return {
    identityKey,
    rows: [],
    state: "ready",
    fetchedAt: 123,
  };
}

describe("cloud remote session identity isolation", () => {
  it("hides an app-lifetime snapshot after an account switch", () => {
    const entry = readyEntry("https://cloud.example.com|user-1");
    expect(
      remoteSessionsEntryForIdentity(entry, "https://cloud.example.com|user-2")
    ).toBeUndefined();
    expect(
      remoteSessionsEntryForIdentity(entry, "https://cloud.example.com|user-1")
    ).toBe(entry);
  });

  it("starts a different identity from an empty loading snapshot", () => {
    expect(
      beginRemoteSessionsFetch(
        readyEntry("https://cloud.example.com|user-1"),
        "https://cloud.example.com|user-2"
      )
    ).toEqual({
      identityKey: "https://cloud.example.com|user-2",
      rows: [],
      state: "loading",
      fetchedAt: 0,
    });
  });
});
