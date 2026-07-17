import { describe, expect, it } from "vitest";

import {
  COLLAB_IDENTITY_KIND,
  COLLAB_SESSION_ACCESS_MODE,
  type RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";

import { toCloudSessionTableItem } from "./cloudSessionTableItem";

const LABELS = {
  fullReplay: "Full replay",
  metadataOnly: "Metadata only",
  notPublished: "Not published",
};

function remoteSession(
  overrides: Partial<RemoteTeammateSessionMetadata> = {}
): RemoteTeammateSessionMetadata {
  return {
    id: "org-1:user-2:session-1",
    orgId: "org-1",
    ownerMemberId: "member-2",
    ownerUserId: "user-2",
    ownerDisplayName: "Taylor",
    ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
    sourceSessionId: "session-1",
    title: "Review the release",
    repoScopeKey: "github.com/acme/orgii",
    cliAgentType: "codex",
    agentDisplayName: "Codex",
    model: "gpt-5.2",
    accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
    eventsEpoch: 1,
    eventsFrozenSeq: 12,
    eventsCount: 14,
    eventsTailHash: "tail-hash",
    ...overrides,
  };
}

describe("toCloudSessionTableItem", () => {
  it("maps replayable cloud metadata into the shared session table shape", () => {
    const item = toCloudSessionTableItem(remoteSession(), LABELS);

    expect(item).toMatchObject({
      id: "org-1:user-2:session-1",
      title: "Review the release",
      description: "Taylor",
      ownerLabel: "Taylor",
      agentLabel: "Codex",
      workspaceLabel: "github.com/acme/orgii",
      workspaceTitle: "github.com/acme/orgii",
      statusLabel: "Full replay",
      disabled: false,
      testId: "cloud-org-session-row",
    });
    expect(item.modelLabel).toBeTruthy();
    expect(item.dataAttributes).toEqual({
      "data-cloud-session-id": "session-1",
      "data-cloud-session-owner-id": "user-2",
      "data-cloud-session-access-mode": "full_replay",
    });
  });

  it("keeps metadata-only sessions visible but disables replay", () => {
    const item = toCloudSessionTableItem(
      remoteSession({
        accessMode: COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        eventsEpoch: undefined,
        eventsFrozenSeq: undefined,
        eventsCount: undefined,
        eventsTailHash: undefined,
      }),
      LABELS
    );

    expect(item.statusLabel).toBe("Metadata only");
    expect(item.disabled).toBe(true);
  });
});
