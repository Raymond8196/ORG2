/**
 * Windows WebView2 may return native keyboard focus to the document body
 * after the app is reactivated instead of returning it to the text surface
 * that owned focus before Alt+Tab. Keep a per-window bookmark so text-entry
 * surfaces (including ComposerInput and xterm's helper textarea) can recover.
 */
import { createLogger } from "@src/hooks/logger";

const log = createLogger("WinFocusRestore");

type ContentEditableBookmark = {
  kind: "contenteditable";
  anchorNode: Node;
  anchorOffset: number;
  focusNode: Node;
  focusOffset: number;
};

type TextControlBookmark = {
  kind: "text-control";
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};

type FocusBookmark = ContentEditableBookmark | TextControlBookmark | null;

const RESTORABLE_INPUT_TYPES = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

function isContentEditable(element: HTMLElement): boolean {
  return (
    element.isContentEditable ||
    element.getAttribute("contenteditable")?.toLowerCase() === "true"
  );
}

function isRestorableTextEntry(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.disabled;
  if (element instanceof HTMLInputElement) {
    return !element.disabled && RESTORABLE_INPUT_TYPES.has(element.type);
  }
  return isContentEditable(element);
}

function nodeBelongsTo(element: HTMLElement, node: Node | null): node is Node {
  return node !== null && (node === element || element.contains(node));
}

function captureFocusBookmark(
  focusDocument: Document,
  element: HTMLElement
): FocusBookmark {
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start === null || end === null) return null;
    return {
      kind: "text-control",
      start,
      end,
      direction: element.selectionDirection ?? "none",
    };
  }

  if (!isContentEditable(element)) return null;
  const selection = focusDocument.getSelection();
  if (
    !selection ||
    !nodeBelongsTo(element, selection.anchorNode) ||
    !nodeBelongsTo(element, selection.focusNode)
  ) {
    return null;
  }

  return {
    kind: "contenteditable",
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
}

function restoreFocusBookmark(
  focusDocument: Document,
  element: HTMLElement,
  bookmark: FocusBookmark
): void {
  if (!bookmark) return;

  try {
    if (
      bookmark.kind === "text-control" &&
      (element instanceof HTMLTextAreaElement ||
        element instanceof HTMLInputElement)
    ) {
      element.setSelectionRange(
        bookmark.start,
        bookmark.end,
        bookmark.direction
      );
      return;
    }

    if (
      bookmark.kind === "contenteditable" &&
      nodeBelongsTo(element, bookmark.anchorNode) &&
      nodeBelongsTo(element, bookmark.focusNode)
    ) {
      focusDocument
        .getSelection()
        ?.setBaseAndExtent(
          bookmark.anchorNode,
          bookmark.anchorOffset,
          bookmark.focusNode,
          bookmark.focusOffset
        );
    }
  } catch {
    // The input may have rerendered while the native window was inactive.
    // Keeping the restored element focus is still preferable to throwing.
  }
}

function isAvailableFocusTarget(
  focusWindow: Window,
  focusDocument: Document,
  element: HTMLElement
): boolean {
  if (
    !element.isConnected ||
    element.ownerDocument !== focusDocument ||
    !isRestorableTextEntry(element)
  ) {
    return false;
  }

  for (let current: HTMLElement | null = element; current; ) {
    if (
      current.hidden ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = focusWindow.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    current = current.parentElement;
  }

  return true;
}

/**
 * Install one focus bookmark owner for this renderer window.
 *
 * The caller is responsible for Windows platform gating. The returned cleanup
 * cancels a pending restore and removes every app-lifetime listener.
 */
export function installWindowsTextEntryFocusRestoration(
  focusWindow: Window = window,
  focusDocument: Document = document
): () => void {
  let lastFocusedElement: HTMLElement | null = null;
  let lastFocusBookmark: FocusBookmark = null;
  let restoreFrame: number | null = null;
  let restoreTimer: number | null = null;
  let nativeWindowBlurred = false;
  let disposed = false;
  let nativeUnlisten: (() => void) | null = null;

  const isRestorePending = () => restoreFrame !== null || restoreTimer !== null;

  const cancelPendingRestore = () => {
    if (restoreFrame !== null) {
      focusWindow.cancelAnimationFrame(restoreFrame);
      restoreFrame = null;
    }
    if (restoreTimer !== null) {
      focusWindow.clearTimeout(restoreTimer);
      restoreTimer = null;
    }
  };

  const rememberTarget = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !isRestorableTextEntry(target)) {
      return;
    }
    // A focusin on the very element a pending restore targets is the
    // window-activation refocus, not an explicit user choice: keep the
    // pending restore AND its original bookmark so the caret is re-applied.
    if (isRestorePending() && target === lastFocusedElement) {
      return;
    }
    cancelPendingRestore();
    lastFocusedElement = target;
    lastFocusBookmark = captureFocusBookmark(focusDocument, target);
  };

  const captureDepartingSelection = (event: FocusEvent) => {
    if (event.target !== lastFocusedElement || !lastFocusedElement) return;
    lastFocusBookmark = captureFocusBookmark(focusDocument, lastFocusedElement);
  };

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (
      !lastFocusedElement ||
      !(target instanceof Node) ||
      lastFocusedElement.contains(target)
    ) {
      return;
    }

    // WebView2 synthesizes a pointerdown right after Alt+Tab activation
    // (observed 3-4ms after the activation event, with no physical button).
    // Keep the pending restore; performRestore's activeElement guard still
    // honors whatever focus a REAL click settles on.
    if (isRestorePending()) {
      return;
    }

    // A pointer activation while no restore is pending is an explicit focus
    // choice: forget the bookmark so a later window reactivation does not
    // yank focus back to the old text surface.
    lastFocusedElement = null;
    lastFocusBookmark = null;
  };

  // WebView2's DOM window blur/focus events are unreliable across Alt+Tab
  // (observed missed entirely or delivered out of order), so the native
  // Tauri window events are the primary activation signal; the DOM events
  // stay wired as a secondary path and are idempotent with the guards above.
  const markDeactivated = (_source: string) => {
    nativeWindowBlurred = true;
    cancelPendingRestore();
    if (lastFocusedElement) {
      lastFocusBookmark = captureFocusBookmark(
        focusDocument,
        lastFocusedElement
      );
    }
  };

  const performRestore = (target: HTMLElement, bookmark: FocusBookmark) => {
    // OS-level MoveFocus is owned by the Rust activation forwarder
    // (src-tauri/src/app/lifecycle.rs); a second setFocus from the renderer
    // fed the activation echo loop and caused a focus ping-pong storm.
    // A modal, click, or keyboard action may already have focused another
    // control during native activation. Never replace that explicit choice.
    const activeElement = focusDocument.activeElement;
    if (
      activeElement &&
      activeElement !== focusDocument.body &&
      activeElement !== focusDocument.documentElement &&
      activeElement !== target
    ) {
      return;
    }
    if (!isAvailableFocusTarget(focusWindow, focusDocument, target)) {
      if (lastFocusedElement === target) {
        lastFocusedElement = null;
        lastFocusBookmark = null;
      }
      return;
    }

    target.focus({ preventScroll: true });
    restoreFocusBookmark(focusDocument, target, bookmark);
  };

  const handleActivated = (_source: string) => {
    if (!nativeWindowBlurred || isRestorePending()) {
      return;
    }
    nativeWindowBlurred = false;
    const target = lastFocusedElement;
    const bookmark = lastFocusBookmark;
    if (!target) {
      return;
    }

    // After a long deactivation the renderer is suspended and the first
    // animation frame can lag ~500ms; race rAF against a 0ms timer so the
    // restore lands as soon as the event loop turns. First path wins.
    restoreTimer = focusWindow.setTimeout(() => {
      if (restoreTimer === null) return;
      restoreTimer = null;
      if (restoreFrame !== null) {
        focusWindow.cancelAnimationFrame(restoreFrame);
        restoreFrame = null;
      }
      performRestore(target, bookmark);
    }, 0);
    restoreFrame = focusWindow.requestAnimationFrame(() => {
      if (restoreFrame === null) return;
      restoreFrame = null;
      if (restoreTimer !== null) {
        focusWindow.clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      performRestore(target, bookmark);
    });
  };

  const handleWindowBlur = () => markDeactivated("dom-blur");
  const handleWindowFocus = () => handleActivated("dom-focus");

  const initiallyActiveElement = focusDocument.activeElement;
  if (
    initiallyActiveElement instanceof HTMLElement &&
    isRestorableTextEntry(initiallyActiveElement)
  ) {
    lastFocusedElement = initiallyActiveElement;
    lastFocusBookmark = captureFocusBookmark(
      focusDocument,
      initiallyActiveElement
    );
  }

  focusDocument.addEventListener("focusin", rememberTarget);
  focusDocument.addEventListener("focusout", captureDepartingSelection);
  focusDocument.addEventListener("pointerdown", handlePointerDown, true);
  focusWindow.addEventListener("blur", handleWindowBlur);
  focusWindow.addEventListener("focus", handleWindowFocus);

  // Primary activation signal: Tauri native window focus events, delivered
  // from the OS window manager via IPC. Never throws at import time; a
  // non-Tauri host (tests, browser mode) rejects and falls back to DOM only.
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const unlisten = await getCurrentWindow().onFocusChanged(
        ({ payload: focused }) => {
          if (disposed) return;
          if (focused) handleActivated("native");
          else markDeactivated("native");
        }
      );
      if (disposed) {
        void unlisten();
        return;
      }
      nativeUnlisten = unlisten;
    } catch {
      log.warn("native focus channel unavailable; DOM events only");
    }
  })();

  return () => {
    disposed = true;
    nativeUnlisten?.();
    cancelPendingRestore();
    focusDocument.removeEventListener("focusin", rememberTarget);
    focusDocument.removeEventListener("focusout", captureDepartingSelection);
    focusDocument.removeEventListener("pointerdown", handlePointerDown, true);
    focusWindow.removeEventListener("blur", handleWindowBlur);
    focusWindow.removeEventListener("focus", handleWindowFocus);
  };
}
