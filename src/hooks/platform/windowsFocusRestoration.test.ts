// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { installWindowsTextEntryFocusRestoration } from "./windowsFocusRestoration";

function installFrameQueue() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });

  return {
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(performance.now()));
    },
    size() {
      return callbacks.size;
    },
  };
}

function leaveAndReturnToWindow(element: HTMLElement) {
  window.dispatchEvent(new Event("blur"));
  element.blur();
  window.dispatchEvent(new Event("focus"));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("installWindowsTextEntryFocusRestoration", () => {
  it("restores a composer and its exact contenteditable caret", () => {
    const frames = installFrameQueue();
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    const text = document.createTextNode("hello");
    composer.append(text);
    document.body.append(composer);

    composer.focus();
    const selection = document.getSelection();
    selection?.setBaseAndExtent(text, 2, text, 2);
    // AppDeferredServices installs this listener after the routed UI may have
    // already autofocused its composer.
    const cleanup = installWindowsTextEntryFocusRestoration();

    leaveAndReturnToWindow(composer);
    expect(frames.size()).toBe(1);
    frames.flush();

    expect(document.activeElement).toBe(composer);
    expect(selection?.anchorNode).toBe(text);
    expect(selection?.anchorOffset).toBe(2);
    cleanup();
  });

  it("restores xterm's text entry target instead of a mounted composer", () => {
    const frames = installFrameQueue();
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    const terminalInput = document.createElement("textarea");
    terminalInput.className = "xterm-helper-textarea";
    document.body.append(composer, terminalInput);

    const cleanup = installWindowsTextEntryFocusRestoration();
    composer.focus();
    terminalInput.focus();

    leaveAndReturnToWindow(terminalInput);
    frames.flush();

    expect(document.activeElement).toBe(terminalInput);
    cleanup();
  });

  it("does not override a pointer choice made while the window activates", () => {
    const frames = installFrameQueue();
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    const transcript = document.createElement("div");
    document.body.append(composer, transcript);

    const cleanup = installWindowsTextEntryFocusRestoration();
    composer.focus();
    leaveAndReturnToWindow(composer);
    transcript.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true })
    );
    frames.flush();

    expect(document.activeElement).toBe(document.body);
    cleanup();
  });

  it("does not restore an input that was hidden while the app was inactive", () => {
    const frames = installFrameQueue();
    const terminalInput = document.createElement("textarea");
    const hiddenPanel = document.createElement("div");
    hiddenPanel.append(terminalInput);
    document.body.append(hiddenPanel);

    const cleanup = installWindowsTextEntryFocusRestoration();
    terminalInput.focus();
    window.dispatchEvent(new Event("blur"));
    terminalInput.blur();
    hiddenPanel.style.display = "none";
    window.dispatchEvent(new Event("focus"));
    frames.flush();

    expect(document.activeElement).toBe(document.body);

    hiddenPanel.style.display = "";
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    frames.flush();
    expect(document.activeElement).toBe(document.body);
    cleanup();
  });

  it("coalesces focus events and cancels pending work on cleanup", () => {
    const frames = installFrameQueue();
    const composer = document.createElement("div");
    composer.setAttribute("contenteditable", "true");
    document.body.append(composer);

    const cleanup = installWindowsTextEntryFocusRestoration();
    composer.focus();
    window.dispatchEvent(new Event("blur"));
    composer.blur();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));

    expect(frames.size()).toBe(1);
    cleanup();
    expect(frames.size()).toBe(0);
  });
});
