import { describe, expect, it } from "vitest";

import type { CliLaunchProfileView } from "@src/api/tauri/rpc/schemas/agentOrgs";

import { formatCliTuiCommand } from "./cliTerminalSession";

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
