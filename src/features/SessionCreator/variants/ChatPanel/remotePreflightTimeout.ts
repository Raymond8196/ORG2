export const REMOTE_PREFLIGHT_TIMEOUT_MS = 25_000;

export function remotePreflightTimeoutMessage(timeoutMs: number): string {
  return `Remote SSH test timed out after ${Math.round(
    timeoutMs / 1000
  )}s. Check the Tauri dev console for cli_remote_preflight logs, then retry.`;
}

export async function withRemotePreflightTimeout<T>(
  pending: Promise<T>,
  timeoutMs = REMOTE_PREFLIGHT_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(remotePreflightTimeoutMessage(timeoutMs)));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
