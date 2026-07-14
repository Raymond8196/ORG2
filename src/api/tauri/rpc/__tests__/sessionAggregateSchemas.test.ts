import { describe, expect, it } from "vitest";

import {
  ExternalHistorySidebarListInput,
  ExternalHistorySidebarResponseSchema,
} from "../schemas/sessionAggregate";

describe("external history sidebar schemas", () => {
  it("accepts bounded non-overlapping bucket requests", () => {
    expect(
      ExternalHistorySidebarListInput.parse({
        source: "codex_app",
        buckets: [
          { bucket: "today", startMs: 200, limit: 10, offset: 0 },
          {
            bucket: "yesterday",
            startMs: 100,
            endMs: 200,
            limit: 10,
            offset: 0,
          },
        ],
      }).buckets
    ).toHaveLength(2);
  });

  it("rejects duplicate buckets and oversized pages", () => {
    expect(() =>
      ExternalHistorySidebarListInput.parse({
        source: "codex_app",
        buckets: [
          { bucket: "today", limit: 10, offset: 0 },
          { bucket: "today", limit: 51, offset: 0 },
        ],
      })
    ).toThrow();
  });

  it("validates the lightweight response shape", () => {
    const parsed = ExternalHistorySidebarResponseSchema.parse({
      source: "codex_app",
      buckets: [
        {
          bucket: "yesterday",
          sessions: [
            {
              sessionId: "codexapp-1",
              name: "Cached session",
              createdAt: "2026-07-11T01:00:00Z",
              updatedAt: "2026-07-11T02:00:00Z",
            },
          ],
          hasMore: false,
        },
      ],
    });

    expect(parsed.buckets[0].sessions[0]).toEqual({
      sessionId: "codexapp-1",
      name: "Cached session",
      createdAt: "2026-07-11T01:00:00Z",
      updatedAt: "2026-07-11T02:00:00Z",
    });
  });
});
