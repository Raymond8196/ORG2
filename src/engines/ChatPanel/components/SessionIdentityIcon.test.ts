import { describe, expect, it } from "vitest";

import { resolveSessionIdentityIconColorClass } from "./SessionIdentityIcon";

describe("resolveSessionIdentityIconColorClass", () => {
  it("keeps selected monochrome model icons on the foreground color", () => {
    expect(resolveSessionIdentityIconColorClass(true, true)).toBe(
      "text-text-1"
    );
  });

  it("keeps selected generic session glyphs on the primary color", () => {
    expect(resolveSessionIdentityIconColorClass(true, false)).toBe(
      "text-primary-6"
    );
  });

  it("uses the inactive foreground for unselected monochrome icons", () => {
    expect(resolveSessionIdentityIconColorClass(false, true)).toBe(
      "text-text-2"
    );
  });
});
