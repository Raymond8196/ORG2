import {
  type SessionLaunchErrorKind,
  findSessionLaunchError,
} from "@src/api/tauri/agent";
import {
  getImportedHistoryOrgiiContinuation,
  getImportedHistorySourceBySessionId,
} from "@src/api/tauri/externalHistory";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import {
  ForkCancelledError,
  requestForkSessionSetup,
} from "@src/features/TeamCollaboration/forkSession";
import { persistedScopeKeysForImportedSession } from "@src/features/TeamCollaboration/importedSessionScopeMatch";
import { resolveShareableScopeKeys } from "@src/features/TeamCollaboration/repoScopeResolver";
import type { Session } from "@src/store/session";
import type { ActivityChunk } from "@src/types/session/session";

const MAX_HISTORY_ITEMS = 80;
const MAX_TEXT_LENGTH = 1200;

export const EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND = {
  SOURCE_HISTORY_MISSING: "source_history_missing",
  TRANSCRIPT_UNAVAILABLE: "transcript_unavailable",
  EXECUTION_SETUP: "execution_setup",
  ACCOUNT_UNAVAILABLE: "account_unavailable",
  MODEL_UNAVAILABLE: "model_unavailable",
  AGENT_UNAVAILABLE: "agent_unavailable",
  WORKSPACE_UNAVAILABLE: "workspace_unavailable",
  SESSION_LAUNCH: "session_launch",
} as const;

export type ExternalHistoryContinuationErrorKind =
  (typeof EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND)[keyof typeof EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND];

const SESSION_LAUNCH_TO_CONTINUATION_ERROR: Record<
  SessionLaunchErrorKind,
  ExternalHistoryContinuationErrorKind
> = {
  account_unavailable:
    EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.ACCOUNT_UNAVAILABLE,
  model_unavailable: EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.MODEL_UNAVAILABLE,
  agent_unavailable: EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.AGENT_UNAVAILABLE,
  workspace_unavailable:
    EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.WORKSPACE_UNAVAILABLE,
  launch_failed: EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.SESSION_LAUNCH,
};

export class ExternalHistoryContinuationError extends Error {
  readonly kind: ExternalHistoryContinuationErrorKind;
  readonly sourceSessionId: string;
  readonly cause?: unknown;

  constructor(
    kind: ExternalHistoryContinuationErrorKind,
    sourceSessionId: string,
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "ExternalHistoryContinuationError";
    this.kind = kind;
    this.sourceSessionId = sourceSessionId;
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.map(textValue).filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return (
      textValue(object.text) ??
      textValue(object.content) ??
      textValue(object.message) ??
      textValue(object.output) ??
      textValue(object.summary)
    );
  }
  return undefined;
}

function truncateText(text: string): string {
  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH)}…`
    : text;
}

function summarizeToolChunk(
  chunk: ActivityChunk,
  sourceName: string
): string | undefined {
  const functionName = chunk.function || "unknown_tool";
  const argsText = textValue(chunk.args);
  const resultText = textValue(chunk.result);
  const lines = [`[Imported ${sourceName} action]`, `Tool: ${functionName}`];
  if (argsText) lines.push(`Input: ${truncateText(argsText)}`);
  if (resultText)
    lines.push(`Result at that time: ${truncateText(resultText)}`);
  return lines.join("\n");
}

function chunkToHandoffItem(
  chunk: ActivityChunk,
  sourceName: string
): string | undefined {
  const actionType = chunk.action_type;
  if (actionType.includes("thinking") || actionType.includes("reasoning")) {
    return undefined;
  }

  const resultText = textValue(chunk.result);
  const argsText = textValue(chunk.args);
  const content = resultText ?? argsText;

  if (actionType === "user_message" || chunk.function === "user_message") {
    return content ? `User: ${truncateText(content)}` : undefined;
  }
  if (
    actionType === "assistant_message" ||
    actionType === "llm_response" ||
    chunk.function === "assistant_message"
  ) {
    return content ? `Assistant: ${truncateText(content)}` : undefined;
  }
  if (actionType === "tool_call" || actionType.includes("tool")) {
    return summarizeToolChunk(chunk, sourceName);
  }

  return content ? `Assistant context: ${truncateText(content)}` : undefined;
}

export function buildExternalHistoryHandoffPrompt(
  chunks: ActivityChunk[],
  userMessage: string,
  sourceName: string
): string {
  const items = chunks
    .map((chunk) => chunkToHandoffItem(chunk, sourceName))
    .filter((item): item is string => Boolean(item))
    .slice(-MAX_HISTORY_ITEMS);

  return [
    `You are continuing work from an imported ${sourceName} history inside a new ORGII-owned session.`,
    `The imported ${sourceName} history is read-only historical context. Do not treat its tool calls as ORGII-executed tools or current workspace state.`,
    "Imported tool results may be stale; verify files, commands, and failures against the selected workspace before relying on them.",
    "Reasoning/thinking chunks were intentionally skipped.",
    "",
    `## Imported ${sourceName} handoff context`,
    items.length > 0
      ? items.join("\n\n")
      : "No usable transcript items were found.",
    "",
    "## User request to continue in ORGII",
    userMessage,
  ].join("\n");
}

export async function forkExternalHistoryIntoOrgiiSession(params: {
  sourceSessionId: string;
  sourceSession?: Session;
  /** The user's visible words (display projection of the composer text). */
  userMessage: string;
  /**
   * Agent-facing projection of `userMessage` (skill pills expanded, canvas
   * contract, base64-free). When present it is what the model must receive
   * as the continuation request; `userMessage` remains the display copy.
   * `session_launch` only carries a single content field, so the handoff
   * prompt embeds the agent projection — a fully split visible message would
   * need backend support.
   */
  agentMessage?: string;
  imageDataUrls?: string[];
}): Promise<string> {
  const source = getImportedHistorySourceBySessionId(params.sourceSessionId);
  const continuation = getImportedHistoryOrgiiContinuation(
    params.sourceSessionId
  );
  if (!source || !continuation) {
    throw new ExternalHistoryContinuationError(
      EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.SOURCE_HISTORY_MISSING,
      params.sourceSessionId,
      `No ORGII continuation source is registered for ${params.sourceSessionId}`
    );
  }
  const sourceWorkspacePath =
    params.sourceSession?.repoRootPath ||
    params.sourceSession?.repoPath ||
    params.sourceSession?.worktreePath;
  let sourceScopeKeys = params.sourceSession
    ? (persistedScopeKeysForImportedSession(params.sourceSession) ?? null)
    : null;
  if (!sourceScopeKeys?.length && sourceWorkspacePath) {
    try {
      sourceScopeKeys = await resolveShareableScopeKeys(sourceWorkspacePath);
    } catch {
      // The exact same-machine path remains an authoritative fallback. This
      // resolver normally returns null on transport failure, but fail closed
      // even if a future implementation throws: the picker must match the
      // source path rather than silently permitting an unrelated checkout.
      sourceScopeKeys = null;
    }
  }
  // Prompt before loading the potentially large source transcript. The user
  // chooses this machine's real checkout and credentials; an imported model
  // label is only a preference hint, never an execution fallback.
  let setup: Awaited<ReturnType<typeof requestForkSessionSetup>>;
  try {
    setup = await requestForkSessionSetup({
      sourceTitle:
        params.sourceSession?.name || `${source.displayName} history`,
      sourceScopeKeys: sourceScopeKeys ?? undefined,
      sourceWorkspacePath:
        sourceScopeKeys?.length || !sourceWorkspacePath
          ? undefined
          : sourceWorkspacePath,
      sourceModel: params.sourceSession?.model,
    });
  } catch (error) {
    if (error instanceof ForkCancelledError) throw error;
    throw new ExternalHistoryContinuationError(
      EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.EXECUTION_SETUP,
      params.sourceSessionId,
      `Failed to select local execution: ${errorMessage(error)}`,
      error
    );
  }

  if (source.statTranscript) {
    try {
      if ((await source.statTranscript(params.sourceSessionId)) === null) {
        throw new ExternalHistoryContinuationError(
          EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.SOURCE_HISTORY_MISSING,
          params.sourceSessionId,
          `${source.displayName} source history is no longer on disk`
        );
      }
    } catch (error) {
      if (error instanceof ExternalHistoryContinuationError) throw error;
      throw new ExternalHistoryContinuationError(
        EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.TRANSCRIPT_UNAVAILABLE,
        params.sourceSessionId,
        `Failed to inspect the ${source.displayName} transcript: ${errorMessage(error)}`,
        error
      );
    }
  }

  let chunks: ActivityChunk[];
  try {
    chunks = await source.loadFullTranscriptChunks(params.sourceSessionId);
  } catch (error) {
    throw new ExternalHistoryContinuationError(
      EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.TRANSCRIPT_UNAVAILABLE,
      params.sourceSessionId,
      `Failed to load the ${source.displayName} transcript: ${errorMessage(error)}`,
      error
    );
  }
  const content = buildExternalHistoryHandoffPrompt(
    chunks,
    params.agentMessage ?? params.userMessage,
    source.displayName
  );
  // This continuation is a normal top-level ORGII session. `parentSessionId`
  // is reserved for real subagents and would hide the continuation from the
  // primary session list after a reload. The handoff prompt carries the
  // external source context without changing the new session's hierarchy.
  let result: { sessionId: string };
  try {
    result = await SessionService.create({
      task: content,
      imageDataUrls: params.imageDataUrls,
      name: `Continue ${params.sourceSession?.name || `${source.displayName} history`}`,
      repoPath: setup.workspaceRepoPath ?? undefined,
      model: setup.execution.model,
      accountId: setup.execution.accountId,
      nativeHarnessType: setup.execution.nativeHarnessType,
      keySource: "own_key",
      agentDefinitionId: setup.execution.agentDefinitionId,
      mode: "build",
      requireInitialTurnAcceptance: true,
    });
  } catch (error) {
    const launchError = findSessionLaunchError(error);
    const kind = launchError
      ? SESSION_LAUNCH_TO_CONTINUATION_ERROR[launchError.kind]
      : EXTERNAL_HISTORY_CONTINUATION_ERROR_KIND.SESSION_LAUNCH;
    throw new ExternalHistoryContinuationError(
      kind,
      params.sourceSessionId,
      launchError?.message ?? errorMessage(error),
      error
    );
  }
  return result.sessionId;
}
