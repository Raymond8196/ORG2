import { Provider, createStore } from "jotai";
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KEY_SOURCE } from "@src/api/tauri/session";
import {
  dispatchCategoryAtom,
  selectedAgentDefinitionIdAtom,
} from "@src/store/session/creatorStateAtom";

import {
  type SessionValidationResult,
  useSessionValidation,
} from "./useSessionValidation";

describe("useSessionValidation", () => {
  it("accepts a remote CLI working directory without a selected local repo", () => {
    const store = createStore();
    store.set(dispatchCategoryAtom, "cli_agent");
    store.set(selectedAgentDefinitionIdAtom, null);

    let result: SessionValidationResult | undefined;

    function Probe(): null {
      // Test probe: capture the hook result synchronously from server rendering.
      // eslint-disable-next-line react-hooks/globals
      result = useSessionValidation({
        effectiveRepoId: "",
        editorContent: "read a.txt",
        advancedConfig: {
          keySource: KEY_SOURCE.OWN,
          cliAgentType: "claude_code",
          remoteTarget: {
            host: "qlg@172.16.10.239",
            workingDir: "/home/qlg/wkspaces/ORG2",
          },
        },
        providers: [],
        agents: [],
      }).validateSessionConfig();
      return null;
    }

    renderToString(
      React.createElement(Provider, { store }, React.createElement(Probe))
    );

    expect(result).toEqual({ valid: true, errors: [] });
  });
});
