import type { Org2CloudOrg } from "./org2CloudOrgsAtom";

/**
 * Org-wide Realtime planes are demand-driven: no socket is held for a local
 * or personal scope; membership, data, and presence channels are joined only
 * for the cloud org the workspace is actively using. The subscription
 * true-edge performs the compensating roster read when that scope is opened.
 */
export function resolveActiveRealtimeOrgId(
  cloudOrgs: readonly Pick<Org2CloudOrg, "orgId">[],
  requestedOrgId: string | null
): string | null {
  if (!requestedOrgId) return null;
  return cloudOrgs.some((org) => org.orgId === requestedOrgId)
    ? requestedOrgId
    : null;
}
