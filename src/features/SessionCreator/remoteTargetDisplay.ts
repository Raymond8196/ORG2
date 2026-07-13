import type { ExecTargetWire } from "@src/api/tauri/agent/session";

export interface RemoteTargetDisplay {
  hostLabel: string;
  workspaceLabel?: string;
  title: string;
}

export function basenameFromPath(path: string | null | undefined): string {
  const trimmed = path?.trim().replace(/\/+$/u, "") ?? "";
  if (!trimmed) return "";
  return trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
}

export function remoteTargetFromExecTarget(
  execTarget: ExecTargetWire | null | undefined
): { host: string; port?: number } | null {
  if (!execTarget || execTarget === "local" || !("remote" in execTarget)) {
    return null;
  }

  const host = execTarget.remote.host.trim();
  if (!host) return null;

  return {
    host,
    port: execTarget.remote.port,
  };
}

export function buildRemoteTargetDisplay(input: {
  host: string;
  port?: number;
  workspacePath?: string | null;
}): RemoteTargetDisplay | null {
  const host = input.host.trim();
  if (!host) return null;

  const hostLabel = input.port ? `${host}:${input.port}` : host;
  const workspaceLabel = basenameFromPath(input.workspacePath);
  return {
    hostLabel,
    workspaceLabel: workspaceLabel || undefined,
    title: workspaceLabel ? `${hostLabel} · ${input.workspacePath}` : hostLabel,
  };
}
