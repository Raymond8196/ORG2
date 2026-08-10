import { describe, expect, it, vi } from "vitest";

import {
  CANVAS_SHARE_HASH_PREFIX,
  CANVAS_SHARE_SHORT_HASH_PREFIX,
  MAX_CANVAS_SHARE_SOURCE_BYTES,
  buildCanvasShareLink,
  buildSelfContainedCanvasShareLink,
  encodeCanvasSharePayload,
  getCanvasShareAvailability,
  parseCanvasShareHash,
} from "./canvasShareProtocol";

describe("Canvas share protocol", () => {
  it("round-trips only the selected Canvas snapshot", async () => {
    const controller = new AbortController();
    const payloadWithPrivateFields = {
      mode: "react" as const,
      title: "Interactive prototype",
      content: "function App(){ return <button>Start</button>; }",
      eventId: "event-secret",
      revisesEventId: "event-older",
      streaming: false,
    };
    const encoded = await encodeCanvasSharePayload(
      payloadWithPrivateFields,
      controller.signal
    );
    const link = buildSelfContainedCanvasShareLink(
      encoded,
      "https://example.test/viewer/"
    );

    const hash = new URL(link).hash;
    expect(hash.startsWith(CANVAS_SHARE_HASH_PREFIX)).toBe(true);
    await expect(parseCanvasShareHash(hash)).resolves.toEqual({
      version: 1,
      canvas: {
        mode: "react",
        title: "Interactive prototype",
        content: "function App(){ return <button>Start</button>; }",
      },
    });
    expect(link).not.toContain("event-secret");
    expect(link).not.toContain("event-older");
  });

  it("round-trips a realistic large interactive Canvas", async () => {
    const content =
      `function App(){const [step,setStep]=React.useState(0);return <button onClick={()=>setStep(step+1)}>Step {step}</button>;}`.repeat(
        180
      );
    const encoded = await encodeCanvasSharePayload({
      mode: "react",
      title: "Large prototype",
      content,
    });
    const link = buildSelfContainedCanvasShareLink(
      encoded,
      "https://example.test/viewer/"
    );

    const decoded = await parseCanvasShareHash(new URL(link).hash);
    expect(decoded.canvas.content).toBe(content);
    expect(link.length).toBeLessThan(64 * 1024);
  });

  it("does not allow incomplete, streaming, local URL, or oversized Canvases", () => {
    expect(getCanvasShareAvailability(null, false)).toEqual({
      available: false,
      reason: "empty",
    });
    expect(
      getCanvasShareAvailability(
        { mode: "html", content: "<p>Still changing</p>" },
        true
      )
    ).toEqual({ available: false, reason: "streaming" });
    expect(
      getCanvasShareAvailability(
        { mode: "url", url: "file:///tmp/a.html" },
        false
      )
    ).toEqual({ available: false, reason: "local-url" });
    expect(
      getCanvasShareAvailability(
        {
          mode: "html",
          content: "x".repeat(MAX_CANVAS_SHARE_SOURCE_BYTES + 1),
        },
        false
      )
    ).toEqual({ available: false, reason: "source-too-large" });
  });

  it("avoids UTF-8 allocation for ordinary Canvas eligibility checks", () => {
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      expect(
        getCanvasShareAvailability(
          {
            mode: "html",
            content: "x".repeat(Math.floor(MAX_CANVAS_SHARE_SOURCE_BYTES / 3)),
          },
          false
        )
      ).toEqual({ available: true });
      expect(encodeSpy).not.toHaveBeenCalled();

      expect(
        getCanvasShareAvailability(
          {
            mode: "html",
            content: "你".repeat(
              Math.floor(MAX_CANVAS_SHARE_SOURCE_BYTES / 3) + 1
            ),
          },
          false
        )
      ).toEqual({ available: false, reason: "source-too-large" });
      expect(encodeSpy).toHaveBeenCalledOnce();
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it("rejects malformed public links at the decoding boundary", async () => {
    await expect(
      parseCanvasShareHash(`${CANVAS_SHARE_HASH_PREFIX}not-a-gzip-payload`)
    ).rejects.toMatchObject({ code: "invalid-payload" });
  });

  it("rejects a compressed oversized payload at the decoding boundary", async () => {
    const content = "x".repeat(MAX_CANVAS_SHARE_SOURCE_BYTES + 1);
    await expect(
      buildCanvasShareLink(
        { mode: "html", content },
        "https://example.test/viewer/"
      )
    ).rejects.toMatchObject({ code: "source-too-large" });
  });

  it("does no encoding when generation is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      await expect(
        encodeCanvasSharePayload(
          { mode: "html", content: "<p>Cancelled</p>" },
          controller.signal
        )
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(encodeSpy).not.toHaveBeenCalled();
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it("prefers a compact hosted link when the upload succeeds", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "abcdefghijklmnopqrstuv",
          expiresAt: "2027-08-09T00:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await buildCanvasShareLink(
        { mode: "html", content: "<p>Short</p>" },
        "https://example.test/viewer/",
        undefined,
        "https://api.example.test/canvas-shares"
      );

      expect(result).toEqual({
        link: `https://example.test/viewer/${CANVAS_SHARE_SHORT_HASH_PREFIX}abcdefghijklmnopqrstuv`,
        kind: "short",
        expiresAt: "2027-08-09T00:00:00.000Z",
      });
      expect(fetchSpy).toHaveBeenCalledOnce();
      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(requestBody.payload).toMatch(/^[A-Za-z0-9_-]+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to a self-contained link when the upload is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    try {
      const result = await buildCanvasShareLink(
        { mode: "html", content: "<p>Still shareable</p>" },
        "https://example.test/viewer/",
        undefined,
        "https://api.example.test/canvas-shares"
      );

      expect(result.kind).toBe("self-contained");
      expect(result.link).toContain(CANVAS_SHARE_HASH_PREFIX);
      await expect(
        parseCanvasShareHash(new URL(result.link).hash)
      ).resolves.toMatchObject({
        canvas: { content: "<p>Still shareable</p>" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
