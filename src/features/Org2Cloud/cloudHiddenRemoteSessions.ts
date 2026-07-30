/**
 * localStorage-backed "hidden remote session" bookkeeping for cloud Team
 * Sessions. A viewer's row-menu "Remove" action deletes the local copy and
 * hides the teammate row WITHOUT touching the shared cloud record — and it
 * doubles as an offline-sync unsubscribe: the background scheduler must
 * never re-import a row the user explicitly removed (org policy would
 * otherwise pull the copy right back). A manual replay of the row is the
 * resubscribe: it clears the entry.
 *
 * Lives in the feature layer because both the sidebar section (UI filter)
 * and the offline-sync scheduler (candidate filter) consume it.
 */
export const HIDDEN_REMOTE_SESSIONS_STORAGE_KEY =
  "orgii:org2-cloud-v1:hidden-remote-sessions";

export function readHiddenRemoteSessionIds(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const parsed = JSON.parse(
      localStorage.getItem(HIDDEN_REMOTE_SESSIONS_STORAGE_KEY) ?? "[]"
    );
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenRemoteSessionIds(ids: ReadonlySet<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      HIDDEN_REMOTE_SESSIONS_STORAGE_KEY,
      JSON.stringify([...ids])
    );
  } catch {
    // Best-effort persistence only.
  }
}

export function hiddenRemoteSessionKey(orgId: string, rowId: string): string {
  return `${orgId}|${rowId}`;
}

/** Row ids hidden ("unsubscribed") for one org, from the persisted set. */
export function hiddenRemoteRowIdsForOrg(orgId: string): Set<string> {
  const prefix = `${orgId}|`;
  const scoped = new Set<string>();
  for (const key of readHiddenRemoteSessionIds()) {
    if (key.startsWith(prefix)) scoped.add(key.slice(prefix.length));
  }
  return scoped;
}
