import { describe, expect, it } from "vitest";

import {
  type CloudOrgRemoteSessionsEntry,
  MAX_REMOTE_SESSIONS_VERSION_KEYS,
  MAX_REMOTE_SESSION_CACHE_ENTRIES,
  beginRemoteSessionsFetch,
  rememberRemoteSessionsFetchedVersion,
  remoteSessionsEntryForIdentity,
  writeRemoteSessionsEntry,
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

  it("bounds visited-org version bookkeeping with LRU eviction", () => {
    const versions = new Map<string, number>();
    for (let index = 0; index <= MAX_REMOTE_SESSIONS_VERSION_KEYS; index += 1) {
      rememberRemoteSessionsFetchedVersion(versions, `org-${index}`, index);
    }
    expect(versions.size).toBe(MAX_REMOTE_SESSIONS_VERSION_KEYS);
    expect(versions.has("org-0")).toBe(false);
    expect(versions.get(`org-${MAX_REMOTE_SESSIONS_VERSION_KEYS}`)).toBe(
      MAX_REMOTE_SESSIONS_VERSION_KEYS
    );
  });

  it("bounds cached org session listings with LRU eviction", () => {
    let entries: Record<string, CloudOrgRemoteSessionsEntry> = {};
    for (let index = 0; index <= MAX_REMOTE_SESSION_CACHE_ENTRIES; index += 1) {
      entries = writeRemoteSessionsEntry(
        entries,
        `org-${index}`,
        readyEntry("https://cloud.example.com|user-1")
      );
    }
    expect(Object.keys(entries)).toHaveLength(MAX_REMOTE_SESSION_CACHE_ENTRIES);
    expect(entries["org-0"]).toBeUndefined();
  });
});
