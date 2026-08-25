import type { TFunction } from "i18next";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorStatusBarRight } from "./EditorStatusBarRight";

const t = ((key: string) =>
  key === "workstation.languageServices"
    ? "Language Services"
    : key) as TFunction;

describe("EditorStatusBarRight", () => {
  it("keeps file-type labels out of the status bar", () => {
    const markup = renderToStaticMarkup(
      createElement(EditorStatusBarRight, {
        t,
        commitInfo: null,
        cursor: null,
        hasSelection: false,
        totalLines: 12,
        filePath: "src/example.ts",
        lspButtonRef: createRef<HTMLDivElement>(),
        lspDropdownOpen: false,
        hasActiveSource: true,
        activeLanguageServiceCount: 1,
        onToggleLspDropdown: vi.fn(),
      })
    );

    expect(markup).toContain("LSP");
    expect(markup).not.toContain(">TS<");
    expect(markup).not.toContain("TypeScript");
  });
});
