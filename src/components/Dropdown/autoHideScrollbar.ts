export const AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS =
  "dropdown-options-scrollbar--active";

export interface AutoHideScrollbarState {
  activeElement: HTMLElement | null;
  hideTimer: number | undefined;
}

export function createAutoHideScrollbarState(): AutoHideScrollbarState {
  return {
    activeElement: null,
    hideTimer: undefined,
  };
}

export function revealAutoHideScrollbar(
  element: HTMLElement,
  state: AutoHideScrollbarState,
  hideDelayMs: number
): void {
  if (state.activeElement && state.activeElement !== element) {
    state.activeElement.classList.remove(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS);
  }

  element.classList.add(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS);
  state.activeElement = element;

  if (state.hideTimer !== undefined) {
    window.clearTimeout(state.hideTimer);
  }

  state.hideTimer = window.setTimeout(() => {
    element.classList.remove(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS);
    if (state.activeElement === element) state.activeElement = null;
    state.hideTimer = undefined;
  }, hideDelayMs);
}

export function disposeAutoHideScrollbar(state: AutoHideScrollbarState): void {
  if (state.hideTimer !== undefined) {
    window.clearTimeout(state.hideTimer);
  }
  state.activeElement?.classList.remove(AUTO_HIDE_SCROLLBAR_ACTIVE_CLASS);
  state.activeElement = null;
  state.hideTimer = undefined;
}
