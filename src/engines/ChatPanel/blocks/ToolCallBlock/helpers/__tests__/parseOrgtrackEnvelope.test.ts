import { describe, expect, it } from "vitest";

import { parseOrgtrackEnvelope } from "../cardParsers";

const shell = (command: string) => ({ command });

describe("parseOrgtrackEnvelope", () => {
  it("renders a successful work.create envelope as a card", () => {
    const card = parseOrgtrackEnvelope(shell("org2-pm work create --title x"), {
      exit_code: 0,
      stdout: JSON.stringify({
        apiVersion: "orgtrack/v1",
        ok: true,
        data: {
          frontmatter: { short_id: "AAA-0001", title: "x", status: "backlog" },
        },
      }),
    });
    expect(card).not.toBeNull();
    expect(card?.ok).toBe(true);
    expect(card?.operation).toBe("Created work item");
    expect(card?.shortId).toBe("AAA-0001");
  });

  it("renders an error envelope with the wire code", () => {
    const card = parseOrgtrackEnvelope(shell("org2-pm work claim AAA-0001"), {
      exit_code: 4,
      stdout: JSON.stringify({
        apiVersion: "orgtrack/v1",
        ok: false,
        error: { code: "ALREADY_CLAIMED", message: "taken", retryable: false },
      }),
    });
    expect(card?.ok).toBe(false);
    expect(card?.errorCode).toBe("ALREADY_CLAIMED");
  });

  it("counts items for a list envelope", () => {
    const card = parseOrgtrackEnvelope(shell("org2-pm work list"), {
      exit_code: 0,
      stdout: JSON.stringify({
        apiVersion: "orgtrack/v1",
        ok: true,
        data: { items: [{}, {}, {}] },
      }),
    });
    expect(card?.itemCount).toBe(3);
  });

  it("ignores non-org2-pm commands and non-envelope output", () => {
    expect(parseOrgtrackEnvelope(shell("ls -la"), { stdout: "{}" })).toBeNull();
    expect(
      parseOrgtrackEnvelope(shell("org2-pm work list"), { stdout: "not json" })
    ).toBeNull();
    expect(
      parseOrgtrackEnvelope(shell("org2-pm work list"), {
        stdout: JSON.stringify({ apiVersion: "other/v1", ok: true }),
      })
    ).toBeNull();
  });
});
