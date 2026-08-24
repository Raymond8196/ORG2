import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isRecoverableAppAssetFailure } from "./assetLoadRecovery";

const THEME_LINK_ATTR = "data-orgii-theme";

class ScriptElementMock extends EventTarget {
  constructor(readonly src: string) {
    super();
  }
}

class LinkElementMock extends EventTarget {
  private readonly attributes: Set<string>;

  constructor(
    readonly href: string,
    readonly rel: string,
    attributes: string[] = []
  ) {
    super();
    this.attributes = new Set(attributes);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
}

const originalScriptElement = globalThis.HTMLScriptElement;
const originalLinkElement = globalThis.HTMLLinkElement;

beforeEach(() => {
  Object.defineProperty(globalThis, "HTMLScriptElement", {
    value: ScriptElementMock,
    configurable: true,
  });
  Object.defineProperty(globalThis, "HTMLLinkElement", {
    value: LinkElementMock,
    configurable: true,
  });
});

afterEach(() => {
  if (originalScriptElement === undefined) {
    delete (globalThis as unknown as Record<string, unknown>).HTMLScriptElement;
  } else {
    Object.defineProperty(globalThis, "HTMLScriptElement", {
      value: originalScriptElement,
      configurable: true,
    });
  }
  if (originalLinkElement === undefined) {
    delete (globalThis as unknown as Record<string, unknown>).HTMLLinkElement;
  } else {
    Object.defineProperty(globalThis, "HTMLLinkElement", {
      value: originalLinkElement,
      configurable: true,
    });
  }
});

describe("isRecoverableAppAssetFailure", () => {
  const page = { href: "http://localhost:3000/" };

  it("recovers a WebKit lazy chunk failure even when its name has no chunk marker", () => {
    const script = new ScriptElementMock(
      "http://localhost:3000/src_modules_WorkStation_TabContent_renderers_file_tsx.js"
    );

    expect(isRecoverableAppAssetFailure(script, page)).toBe(true);
  });

  it("recovers a shared async asset emitted by development splitChunks", () => {
    const script = new ScriptElementMock(
      "http://localhost:3000/shared-src_modules_WorkStation_CodeEditor_sourceControl.js"
    );

    expect(isRecoverableAppAssetFailure(script, page)).toBe(true);
  });

  it("recovers a same-origin webpack stylesheet", () => {
    const stylesheet = new LinkElementMock(
      "http://localhost:3000/main.4f2c1a.css",
      "stylesheet"
    );

    expect(isRecoverableAppAssetFailure(stylesheet, page)).toBe(true);
  });

  it("supports Tauri custom-protocol asset URLs", () => {
    const script = new ScriptElementMock("tauri://localhost/assets/editor.js");

    expect(
      isRecoverableAppAssetFailure(script, {
        href: "tauri://localhost/index.html",
      })
    ).toBe(true);
  });

  it("does not reload for third-party scripts or non-stylesheet links", () => {
    const externalScript = new ScriptElementMock(
      "https://cdn.example.com/editor.js"
    );
    const icon = new LinkElementMock("/favicon.ico", "icon");

    expect(isRecoverableAppAssetFailure(externalScript, page)).toBe(false);
    expect(isRecoverableAppAssetFailure(icon, page)).toBe(false);
  });

  it("does not treat ordinary event targets as app assets", () => {
    expect(isRecoverableAppAssetFailure(new EventTarget(), page)).toBe(false);
    expect(isRecoverableAppAssetFailure(null, page)).toBe(false);
  });

  // Regression: theme CSS failures are handled by themeInit/swapThemeCss, which
  // deliberately degrade instead of reloading. Reloading here would burn the
  // chunkReload budget and strand the user on the startup-error panel over a
  // cosmetic stylesheet.
  it("does not reload for a theme stylesheet failure", () => {
    const themeLink = new LinkElementMock("/orgii_main.css", "stylesheet", [
      THEME_LINK_ATTR,
    ]);

    expect(isRecoverableAppAssetFailure(themeLink, page)).toBe(false);
  });

  it("does not reload for a theme preload link", () => {
    const preload = new LinkElementMock("/orgii_dark.css", "preload", [
      "data-orgii-theme-preload",
    ]);

    expect(isRecoverableAppAssetFailure(preload, page)).toBe(false);
  });
});

// Drift guard: the exclusion above keys off a literal attribute name. If a theme
// writer renames it, the exclusion silently stops working and theme failures
// start reloading the app again.
describe("theme link attribute contract", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");

  it.each([
    "src/util/core/init/themeInit.ts",
    "src/util/ui/theme/swapThemeCss.ts",
    "src/util/core/init/assetLoadRecovery.ts",
  ])("%s still references the theme link attribute", (relativePath) => {
    const source = readFileSync(path.join(repoRoot, relativePath), "utf8");
    expect(source).toContain(`"${THEME_LINK_ATTR}"`);
  });
});
