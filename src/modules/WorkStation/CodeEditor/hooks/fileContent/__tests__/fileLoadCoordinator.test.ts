import { describe, expect, it } from "vitest";

import { FileLoadCoordinator } from "../fileLoadCoordinator";

describe("FileLoadCoordinator", () => {
  it("deduplicates an equivalent active read", () => {
    const coordinator = new FileLoadCoordinator();
    const request = coordinator.begin("/repo/a.ts");

    expect(request).not.toBeNull();
    expect(coordinator.begin("/repo/a.ts")).toBeNull();
  });

  it("rejects the old request in an A -> B -> A sequence", () => {
    const coordinator = new FileLoadCoordinator();
    const firstA = coordinator.begin("/repo/a.ts");
    const requestB = coordinator.begin("/repo/b.ts");
    const secondA = coordinator.begin("/repo/a.ts");

    expect(firstA).not.toBeNull();
    expect(requestB).not.toBeNull();
    expect(secondA).not.toBeNull();
    expect(coordinator.isActive(firstA!)).toBe(false);
    expect(coordinator.finish(firstA!)).toBe(false);
    expect(coordinator.isActive(secondA!)).toBe(true);
  });

  it("lets only the owner release the active marker", () => {
    const coordinator = new FileLoadCoordinator();
    const oldRequest = coordinator.begin("/repo/a.ts")!;
    const currentRequest = coordinator.begin("/repo/b.ts")!;

    expect(coordinator.finish(oldRequest)).toBe(false);
    expect(coordinator.isActive(currentRequest)).toBe(true);
    expect(coordinator.finish(currentRequest)).toBe(true);
    expect(coordinator.isActive(currentRequest)).toBe(false);
    expect(coordinator.isLatest(currentRequest)).toBe(true);
  });

  it("invalidates pending and late background work on cancel", () => {
    const coordinator = new FileLoadCoordinator();
    const request = coordinator.begin("/repo/a.ts")!;

    coordinator.cancel();

    expect(coordinator.isActive(request)).toBe(false);
    expect(coordinator.isLatest(request)).toBe(false);
  });
});
