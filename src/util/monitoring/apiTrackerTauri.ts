import { detectInteractionType } from "./apiTrackerInteractions";
import {
  addApiCall,
  dispatchApiCallUpdatedIfTracing,
  findApiCall,
  finishRequestTiming,
  isTrackingEnabled,
  startRequestTiming,
} from "./apiTrackerState";
import type { ApiCall } from "./apiTrackerTypes";
import {
  extractFileInfo,
  getComponentInfo,
  getTauriStack,
} from "./apiTrackerUtils";

interface TauriInternals {
  invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
}

type TauriInternalsHost = {
  __TAURI_INTERNALS__?: TauriInternals;
};

let directTauriInvokePatched = false;
let directTauriInvokeSuppressionDepth = 0;

export async function withDirectTauriInvokeTrackingSuppressed<T>(
  operation: () => Promise<T>
): Promise<T> {
  directTauriInvokeSuppressionDepth += 1;
  try {
    return await operation();
  } finally {
    directTauriInvokeSuppressionDepth -= 1;
  }
}

export function installDirectTauriInvokeTracking(): (() => void) | undefined {
  if (directTauriInvokePatched || typeof window === "undefined") {
    return undefined;
  }

  const tauriInternals = (window as TauriInternalsHost).__TAURI_INTERNALS__;
  const originalInvoke = tauriInternals?.invoke;
  if (!tauriInternals || !originalInvoke) return undefined;

  const patchedTauriInvoke = async (
    cmd: string,
    args?: unknown
  ): Promise<unknown> => {
    if (!isTrackingEnabled() || directTauriInvokeSuppressionDepth > 0) {
      return originalInvoke(cmd, args);
    }

    const requestId = `tauri-direct-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    trackTauriInvoke(cmd, args, requestId);
    try {
      const result = await originalInvoke(cmd, args);
      trackTauriInvokeResult(requestId, result);
      return result;
    } catch (error) {
      trackTauriInvokeResult(requestId, undefined, error);
      throw error;
    }
  };

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    tauriInternals,
    "invoke"
  );

  try {
    Object.defineProperty(tauriInternals, "invoke", {
      configurable: true,
      value: patchedTauriInvoke,
      writable: true,
    });
  } catch {
    return undefined;
  }

  directTauriInvokePatched = true;

  return () => {
    try {
      if (originalDescriptor) {
        Object.defineProperty(tauriInternals, "invoke", originalDescriptor);
      } else {
        delete tauriInternals.invoke;
      }
    } finally {
      directTauriInvokePatched = false;
    }
  };
}

/**
 * Track a Tauri invoke call (Rust backend).
 * Called from the invokeTauri wrapper in tauri/init.ts.
 */
export function trackTauriInvoke(
  cmd: string,
  args: unknown,
  requestId: string
): void {
  if (!isTrackingEnabled()) return;

  const stack = getTauriStack()
    .split("\n")
    .filter((line) => !line.includes("apiTrackerTauri.ts"))
    .join("\n");
  const fileInfo = extractFileInfo(stack);
  const componentInfo = getComponentInfo();

  const apiCall: ApiCall = {
    id: requestId,
    method: "INVOKE",
    url: cmd,
    fullUrl: `tauri://${cmd}`,
    backend: "rust",
    tauriCommand: cmd,
    tauriArgs: args,
    data: args,
    timestamp: new Date().toISOString(),
    componentSelector: componentInfo.selector,
    componentLabel: componentInfo.label,
    interactionType: detectInteractionType(),
    filePath: fileInfo.filePath,
    componentName: fileInfo.componentName,
    functionName: fileInfo.functionName,
    lineNumber: fileInfo.lineNumber,
    stack,
  };

  addApiCall(apiCall);
  startRequestTiming(requestId);
  dispatchApiCallUpdatedIfTracing(apiCall);
}

/** Record the result of a completed Tauri invoke call. */
export function trackTauriInvokeResult(
  requestId: string,
  response: unknown,
  error?: unknown
): void {
  if (!isTrackingEnabled()) return;

  const duration = finishRequestTiming(requestId);
  const apiCall = findApiCall(requestId);
  if (!apiCall) return;

  if (error) {
    apiCall.error = error instanceof Error ? error.message : error;
    apiCall.status = 500;
    apiCall.statusText = "Error";
  } else {
    apiCall.response = response;
    apiCall.status = 200;
    apiCall.statusText = "OK";
  }
  apiCall.duration = duration;

  dispatchApiCallUpdatedIfTracing(apiCall);
}
