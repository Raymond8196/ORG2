import type { Org2CloudOrg } from "./org2CloudOrgsAtom";

/**
 * Org-wide Realtime planes are demand-driven: keep the signed-in user's own
 * membership channel alive globally, but join data/presence channels only for
 * the cloud org the workspace is actively using.
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
