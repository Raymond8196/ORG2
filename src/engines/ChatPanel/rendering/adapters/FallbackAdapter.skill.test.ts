/**
 * Tests for FallbackAdapter's skill-tool routing.
 *
 * The rust-native `skill` tool (lowercase) maps to `tool_call_other` in
 * cli_alias.rs, giving it `ui = "tool_call"` and `chatBlock = "fallback"`.
 * FallbackAdapter must route it to SkillBlock (not the generic ToolCallBlock)
 * so the user sees a dedicated "Reading skill / Skill loaded" card.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RecipeRendererProps } from "../RecipeRenderer";
import { RecipeRenderer } from "../RecipeRenderer";

vi.mock("@src/engines/ChatPanel/hooks/useChatEventReplay", () => ({
  useChatEventReplay: () => ({
    replayEventById: vi.fn(),
    canReplay: false,
  }),
}));

function renderSkillEvent(
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  status: "completed" | "running" | "failed" = "completed"
) {
  const props: RecipeRendererProps = {
    event_id: "event-skill-test",
    functionName: "skill",
    uiCanonical: "tool_call",
    action_type: "tool_call",
    args,
    result,
    status,
  };

  return renderToStaticMarkup(createElement(RecipeRenderer, props));
}

describe("FallbackAdapter skill block routing", () => {
  it("renders skill event with skill name as subtitle", () => {
    const markup = renderSkillEvent(
      { skill: "brainstorming" },
      { observation: "## Skill: brainstorming\n\nContent here." }
    );

    expect(markup).toContain('data-tool-call-name="skill"');
    expect(markup).toContain("brainstorming");
  });

  it("renders running skill event with isLoading state", () => {
    const markup = renderSkillEvent({ skill: "create-rule" }, {}, "running");

    expect(markup).toContain('data-tool-call-name="skill"');
    expect(markup).toContain("create-rule");
  });

  it("renders skill event without skill name gracefully", () => {
    const markup = renderSkillEvent(
      {},
      { observation: "Skill not found." },
      "failed"
    );

    expect(markup).toContain('data-tool-call-name="skill"');
  });

  it("does NOT render as a generic ToolCallBlock with INPUT/OUTPUT sections", () => {
    const markup = renderSkillEvent(
      { skill: "brainstorming" },
      { observation: "## Skill: brainstorming\n\nContent here." }
    );

    expect(markup).not.toContain("INPUT");
    expect(markup).not.toContain("OUTPUT");
  });

  it("renders MCP-prefixed skill tools the same way", () => {
    const props: RecipeRendererProps = {
      event_id: "event-skill-mcp",
      functionName: "mcp_orgii_skill",
      uiCanonical: "skill",
      action_type: "tool_call",
      args: { skill: "code-audit" },
      result: { observation: "## Skill: code-audit\n\nContent here." },
      status: "completed",
    };
    const markup = renderToStaticMarkup(createElement(RecipeRenderer, props));

    expect(markup).toContain("code-audit");
  });
});
