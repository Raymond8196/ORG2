import { resolveCanvasSlashAgentContent } from "./canvasSlashCommand";

interface ResolveAgentMessageContentOptions {
  /** Serialized text retained in chat history. */
  displayText: string;
  /** Skill-expanded, base64-free text prepared for the Agent. */
  agentBase: string;
  hasTransformedPills: boolean;
  contextBlocks: string[];
  enableAgentInterceptors: boolean;
}

/**
 * Produce the Agent-only message projection without mutating the history text.
 */
export function resolveAgentMessageContent({
  displayText,
  agentBase,
  hasTransformedPills,
  contextBlocks,
  enableAgentInterceptors,
}: ResolveAgentMessageContentOptions): string | undefined {
  const canvasContent = enableAgentInterceptors
    ? resolveCanvasSlashAgentContent(agentBase)
    : null;
  const resolvedBase = canvasContent ?? agentBase;

  if (contextBlocks.length > 0) {
    return `${resolvedBase}\n\n${contextBlocks.join("\n\n")}`;
  }
  if (
    canvasContent !== null ||
    hasTransformedPills ||
    agentBase !== displayText
  ) {
    return resolvedBase;
  }
  return undefined;
}
