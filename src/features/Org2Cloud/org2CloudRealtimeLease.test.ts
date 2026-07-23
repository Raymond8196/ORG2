import { describe, expect, it } from "vitest";

import { createOrg2CloudRealtimeLeaseController } from "./org2CloudRealtimeLease";

describe("Org2Cloud Realtime connection lease", () => {
  function setup(initialForeground = true) {
    let foreground = initialForeground;
    const transitions: boolean[] = [];
    const controller = createOrg2CloudRealtimeLeaseController({
      isForeground: () => foreground,
      onChange: (held) => transitions.push(held),
    });
    return {
      controller,
      transitions,
      setForeground(next: boolean) {
        foreground = next;
        controller.refresh();
      },
    };
  }

  it("releases immediately when the window leaves the foreground", () => {
    const { controller, transitions, setForeground } = setup();

    setForeground(false);

    expect(controller.isHeld()).toBe(false);
    expect(transitions).toEqual([false]);
  });

  it("deduplicates blur and visibility events for the same truth", () => {
    const { controller, transitions, setForeground } = setup();

    setForeground(false);
    controller.refresh();

    expect(controller.isHeld()).toBe(false);
    expect(transitions).toEqual([false]);
  });

  it("reacquires immediately when focus returns", () => {
    const { controller, transitions, setForeground } = setup();

    setForeground(false);
    setForeground(true);

    expect(controller.isHeld()).toBe(true);
    expect(transitions).toEqual([false, true]);
  });

  it("releases immediately on pagehide", () => {
    const { controller, transitions } = setup();

    controller.releaseImmediately();

    expect(controller.isHeld()).toBe(false);
    expect(transitions).toEqual([false]);
  });

  it("does not publish after disposal", () => {
    const { controller, transitions, setForeground } = setup();

    controller.dispose();
    setForeground(false);

    expect(controller.isHeld()).toBe(true);
    expect(transitions).toEqual([]);
  });
});
