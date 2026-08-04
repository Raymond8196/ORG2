// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS,
  createAutoHideScrollbarState,
  disposeAutoHideScrollbar,
  revealAutoHideScrollbar,
} from "../autoHideScrollbar";

describe("auto-hide dropdown scrollbar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one hide timer and restarts it for continued scrolling", () => {
    const element = document.createElement("div");
    const state = createAutoHideScrollbarState();

    revealAutoHideScrollbar(element, state, 700);
    expect(element.classList.contains(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS)).toBe(
      true
    );
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(350);
    revealAutoHideScrollbar(element, state, 700);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(699);
    expect(element.classList.contains(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS)).toBe(
      true
    );

    vi.advanceTimersByTime(1);
    expect(element.classList.contains(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS)).toBe(
      false
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the active class and timer when disposed", () => {
    const element = document.createElement("div");
    const state = createAutoHideScrollbarState();

    revealAutoHideScrollbar(element, state, 700);
    disposeAutoHideScrollbar(state);

    expect(element.classList.contains(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS)).toBe(
      false
    );
    expect(state.activeElement).toBeNull();
    expect(state.hideTimer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
