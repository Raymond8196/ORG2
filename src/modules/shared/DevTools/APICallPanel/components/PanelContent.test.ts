import { describe, expect, it } from "vitest";

import type { ApiCallHotspot } from "@src/util/monitoring/apiTracker";

import { selectVisibleApiHotspots } from "./PanelContent";

function hotspot(index: number, isLikelyPolling: boolean): ApiCallHotspot {
  return {
    key: `key-${index}`,
    backend: "python",
    method: "POST",
    target: `/rpc/${index}`,
    count: 3,
    callsPerMinute: 2,
    lastTimestamp: "2026-07-18T00:00:00.000Z",
    firstTimestamp: "2026-07-17T23:59:00.000Z",
    isLikelyPolling,
  };
}

describe("selectVisibleApiHotspots", () => {
  it("keeps the top six and every additional likely-polling group", () => {
    const hotspots = Array.from({ length: 10 }, (_, index) =>
      hotspot(index, index === 7 || index === 9)
    );

    expect(selectVisibleApiHotspots(hotspots).map((item) => item.key)).toEqual([
      "key-0",
      "key-1",
      "key-2",
      "key-3",
      "key-4",
      "key-5",
      "key-7",
      "key-9",
    ]);
  });
});
