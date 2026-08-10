/**
 * Serializes native menu construction and popup work within one WebView.
 *
 * Tauri's menu popup command retains the WebView resource-table lock while the
 * native menu is tracking input. A nested menu request can otherwise re-enter
 * the same WebView and wait forever while the popup waits on the UI thread.
 * Duplicate requests are intentionally dropped instead of queued because a
 * context menu opened after the original interaction has ended is stale UI.
 */

export interface NativeMenuSingleFlightBusy {
  status: "busy";
  activeSource: string;
}

export interface NativeMenuSingleFlightCompleted<T> {
  status: "completed";
  value: T;
}

export type NativeMenuSingleFlightResult<T> =
  | NativeMenuSingleFlightBusy
  | NativeMenuSingleFlightCompleted<T>;

interface ActiveNativeMenuRun {
  source: string;
  token: object;
}

interface NativeMenuSingleFlightState {
  active: ActiveNativeMenuRun | null;
}

const NATIVE_MENU_STATE_KEY = Symbol.for(
  "orgii.tauri.native-menu-single-flight.v1"
);

function getState(): NativeMenuSingleFlightState {
  const host = globalThis as unknown as Record<symbol, unknown>;
  const existing = host[NATIVE_MENU_STATE_KEY];
  if (existing) return existing as NativeMenuSingleFlightState;

  const state: NativeMenuSingleFlightState = { active: null };
  host[NATIVE_MENU_STATE_KEY] = state;
  return state;
}

/**
 * Runs all resource creation and popup work for one native menu as a single
 * non-queueing critical section. The gate is claimed synchronously before the
 * task starts, including before its first Tauri IPC call.
 */
export async function runNativeMenuSingleFlight<T>(
  source: string,
  task: () => Promise<T>
): Promise<NativeMenuSingleFlightResult<T>> {
  const state = getState();
  if (state.active) {
    return { status: "busy", activeSource: state.active.source };
  }

  const token = {};
  state.active = { source, token };

  try {
    return { status: "completed", value: await task() };
  } finally {
    if (state.active?.token === token) {
      state.active = null;
    }
  }
}
