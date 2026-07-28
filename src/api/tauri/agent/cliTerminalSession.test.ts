import { describe, expect, it } from "vitest";

import type { CliLaunchProfileView } from "@src/api/tauri/rpc/schemas/agentOrgs";

import {
  appendCliCommandArgs,
  formatCliTuiCommand,
} from "./cliTerminalSession";

function profile(
  overrides: Partial<CliLaunchProfileView> = {}
): CliLaunchProfileView {
  return {
    agentName: "trae_cli",
    permissionMode: "manual",
    defaultCommand: "trae-cli",
    command: "trae-cli",
    args: [],
    env: {},
    manualArgs: [],
    fullPermissionArgs: [],
    manualEnv: {},
    fullPermissionEnv: {},
    supportedPermissionModes: ["manual"],
    modeDefaults: [],
    commandOverridden: false,
    argsOverridden: false,
    envOverridden: false,
    effectiveCommand: ["trae-cli", "interactive"],
    requiredArgs: ["interactive"],
    ...overrides,
  };
}

describe("formatCliTuiCommand", () => {
  it("adds required interactive arguments to the detected executable", () => {
    expect(formatCliTuiCommand(profile(), "/opt/trae/bin/trae-cli")).toBe(
      "/opt/trae/bin/trae-cli interactive"
    );
  });

  it("omits Codex's prompt-required exec subcommand for interactive TUI launches", () => {
    expect(
      formatCliTuiCommand(
        profile({
          agentName: "codex",
          defaultCommand: "codex",
          command: "codex",
          requiredArgs: ["exec"],
          args: ["--dangerously-bypass-approvals-and-sandbox"],
        }),
        "codex"
      )
    ).toBe("codex --dangerously-bypass-approvals-and-sandbox");
  });

  it("honors command and argument overrides with shell-safe quoting", () => {
    expect(
      formatCliTuiCommand(
        profile({
          commandOverridden: true,
          command: "/Applications/Trae Agent/trae-cli",
          requiredArgs: [],
          args: ["interactive", "two words"],
        }),
        "trae-cli"
      )
    ).toBe("'/Applications/Trae Agent/trae-cli' interactive 'two words'");
  });
});

describe("appendCliCommandArgs", () => {
  it("appends resume arguments after the resolved profile command", () => {
    expect(
      appendCliCommandArgs("claude --permission-mode plan", [
        "--resume",
        "b52f4220-8b0b-46c5-8ee6-001ebf91c6ed",
      ])
    ).toBe(
      "claude --permission-mode plan --resume b52f4220-8b0b-46c5-8ee6-001ebf91c6ed"
    );
  });

  it("quotes unsafe arguments and drops blank ones", () => {
    expect(appendCliCommandArgs("codex", ["resume", " ", "two words"])).toBe(
      "codex resume 'two words'"
    );
    expect(appendCliCommandArgs("codex", [])).toBe("codex");
  });
});
