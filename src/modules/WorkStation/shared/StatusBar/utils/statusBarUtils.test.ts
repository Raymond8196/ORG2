import { getLanguageFromPath } from "./statusBarUtils";

describe("getLanguageFromPath", () => {
  it("uses canonical language display metadata", () => {
    expect(getLanguageFromPath("src/App.tsx")).toBe("TypeScript React");
    expect(getLanguageFromPath("src/header.hpp")).toBe("C++ Header");
    expect(getLanguageFromPath("project/.env.local")).toBe("Environment");
  });

  it("falls back to plain text for missing and unknown paths", () => {
    expect(getLanguageFromPath()).toBe("Plain Text");
    expect(getLanguageFromPath("README.unknown")).toBe("Plain Text");
  });
});
