/**
 * Windows WebView2 may return native keyboard focus to the document body
 * after the app is reactivated instead of returning it to the text surface
 * that owned focus before Alt+Tab. Keep a per-window bookmark so text-entry
 * surfaces (including ComposerInput and xterm's helper textarea) can recover.
 */

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
  let nativeWindowBlurred = false;

  const cancelPendingRestore = () => {
    if (restoreFrame === null) return;
    focusWindow.cancelAnimationFrame(restoreFrame);
    restoreFrame = null;
  };

  const rememberTarget = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !isRestorableTextEntry(target)) {
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

    // A pointer activation is an explicit focus choice. In particular, this
    // prevents a restore queued by `window.focus` from winning over the click
    // that activated the native window.
    cancelPendingRestore();
    lastFocusedElement = null;
    lastFocusBookmark = null;
  };

  const handleWindowBlur = () => {
    nativeWindowBlurred = true;
    cancelPendingRestore();
    if (lastFocusedElement) {
      lastFocusBookmark = captureFocusBookmark(
        focusDocument,
        lastFocusedElement
      );
    }
  };

  const handleWindowFocus = () => {
    if (!nativeWindowBlurred || restoreFrame !== null) return;
    nativeWindowBlurred = false;
    const target = lastFocusedElement;
    const bookmark = lastFocusBookmark;
    if (!target) return;

    restoreFrame = focusWindow.requestAnimationFrame(() => {
      restoreFrame = null;

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
    });
  };

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

  return () => {
    cancelPendingRestore();
    focusDocument.removeEventListener("focusin", rememberTarget);
    focusDocument.removeEventListener("focusout", captureDepartingSelection);
    focusDocument.removeEventListener("pointerdown", handlePointerDown, true);
    focusWindow.removeEventListener("blur", handleWindowBlur);
    focusWindow.removeEventListener("focus", handleWindowFocus);
  };
}
