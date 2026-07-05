import { describe, expect, it } from "vitest";

import type {
  ComposerPillAttrs,
  ComposerSnapshot,
} from "@src/components/ComposerInput/types";

import {
  polishedTextToSnapshot,
  snapshotHasPolishableText,
  snapshotSignature,
  snapshotToPolishText,
} from "../snapshotPlaceholders";

function pillAttrs(
  overrides: Partial<ComposerPillAttrs> = {}
): ComposerPillAttrs {
  return {
    filePath: "C:/repo/src/app.ts",
    fileName: "app.ts",
    isFolder: false,
    iconType: "file",
    lineStart: null,
    lineEnd: null,
    ...overrides,
  };
}

describe("snapshotPlaceholders", () => {
  it("turns a plain snapshot into polish text", () => {
    const snapshot: ComposerSnapshot = {
      parts: [
        { kind: "text", text: "修一下" },
        { kind: "newline" },
        { kind: "text", text: "这个按钮" },
      ],
    };

    expect(snapshotToPolishText(snapshot)).toEqual({
      text: "修一下\n这个按钮",
      pills: [],
    });
  });

  it("round-trips pills through placeholders", () => {
    const attrs = pillAttrs();
    const snapshot: ComposerSnapshot = {
      parts: [
        { kind: "text", text: "请看 " },
        { kind: "pill", attrs },
        { kind: "newline" },
        { kind: "text", text: "把输入框按钮补上" },
      ],
    };

    const polishText = snapshotToPolishText(snapshot);
    const restored = polishedTextToSnapshot(
      "请参考 [[ORGII_PILL_0]]\n补一个输入框润色按钮",
      polishText.pills
    );

    expect(polishText.text).toBe("请看 [[ORGII_PILL_0]]\n把输入框按钮补上");
    expect(restored).toEqual({
      parts: [
        { kind: "text", text: "请参考 " },
        { kind: "pill", attrs },
        { kind: "newline" },
        { kind: "text", text: "补一个输入框润色按钮" },
      ],
    });
  });

  it("rejects a missing pill placeholder", () => {
    const polishText = snapshotToPolishText({
      parts: [
        { kind: "text", text: "改 " },
        { kind: "pill", attrs: pillAttrs() },
      ],
    });

    expect(
      polishedTextToSnapshot("请修改对应文件", polishText.pills)
    ).toBeNull();
  });

  it("rejects duplicate pill placeholders", () => {
    const polishText = snapshotToPolishText({
      parts: [
        { kind: "pill", attrs: pillAttrs() },
        { kind: "text", text: " 修复" },
      ],
    });

    expect(
      polishedTextToSnapshot(
        "[[ORGII_PILL_0]] 和 [[ORGII_PILL_0]] 都需要修",
        polishText.pills
      )
    ).toBeNull();
  });

  it("rejects reordered pill placeholders", () => {
    const first = pillAttrs({ filePath: "C:/repo/a.ts", fileName: "a.ts" });
    const second = pillAttrs({ filePath: "C:/repo/b.ts", fileName: "b.ts" });
    const polishText = snapshotToPolishText({
      parts: [
        { kind: "pill", attrs: first },
        { kind: "text", text: " " },
        { kind: "pill", attrs: second },
      ],
    });

    expect(
      polishedTextToSnapshot(
        "[[ORGII_PILL_1]] 再处理 [[ORGII_PILL_0]]",
        polishText.pills
      )
    ).toBeNull();
  });

  it("detects polishable text separately from pills", () => {
    expect(
      snapshotHasPolishableText({
        parts: [{ kind: "pill", attrs: pillAttrs() }],
      })
    ).toBe(false);

    expect(
      snapshotHasPolishableText({
        parts: [
          { kind: "pill", attrs: pillAttrs() },
          { kind: "text", text: " 修一下" },
        ],
      })
    ).toBe(true);
  });

  it("creates stable snapshot signatures", () => {
    const snapshot: ComposerSnapshot = {
      parts: [{ kind: "text", text: "hello" }],
    };

    expect(snapshotSignature(snapshot)).toBe(snapshotSignature(snapshot));
  });
});
