import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DataSourcePanel from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("./SessionUsagePanel", () => ({
  default: () => createElement("div", null, "Usage dashboard"),
}));

describe("Runtime DataSourcePanel navigation", () => {
  it("keeps its four sections in a separate row below the chat header", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Provider,
        { store: createStore() },
        createElement(DataSourcePanel, {
          assetsContent: createElement("div", null, "Assets content"),
          usageHeaderContent: createElement("div", null, "Quota content"),
        })
      )
    );

    const usage = markup.indexOf("data-source-view-usage");
    const scanning = markup.indexOf("data-source-view-scanning");
    const hooks = markup.indexOf("data-source-view-hooks");
    const assets = markup.indexOf("data-source-view-assets");

    expect(usage).toBeGreaterThanOrEqual(0);
    expect(scanning).toBeGreaterThan(usage);
    expect(hooks).toBeGreaterThan(scanning);
    expect(assets).toBeGreaterThan(hooks);
    expect(markup).toContain("Quota content");
    expect(markup).toContain("justify-center");
    expect(markup).not.toContain("chat-panel-header");
  });
});
