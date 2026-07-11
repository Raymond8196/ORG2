import { describe, expect, it } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import { countActivities } from "..";

describe("countActivities", () => {
  it("counts edit calls even when they target the same file", () => {
    const first = makeSessionEvent({
      action_type: "tool_call",
      function: "edit_file",
      uiCanonical: "edit_file",
      args: { file_path: "src/app.ts" },
    });
    const second = makeSessionEvent({
      action_type: "tool_call",
      function: "edit_file",
      uiCanonical: "edit_file",
      args: { file_path: "src/app.ts" },
    });

    expect(countActivities([first, second], "edit")).toBe(2);
  });

  it("counts a multi-file patch as one edit action", () => {
    const patch = makeSessionEvent({
      action_type: "tool_call",
      function: "apply_patch",
      uiCanonical: "edit_file",
      args: {
        patch_text: [
          "*** Begin Patch",
          "*** Update File: src/app.ts",
          "*** Add File: src/new.ts",
          "*** End Patch",
        ].join("\n"),
      },
    });

    expect(countActivities([patch], "edit")).toBe(1);
  });

  it("counts file deletions as edit actions", () => {
    const deletion = makeSessionEvent({
      action_type: "tool_call",
      function: "delete_file",
      uiCanonical: "delete_file",
      args: { file_path: "src/obsolete.ts" },
    });

    expect(countActivities([deletion], "edit")).toBe(1);
  });

  it("counts distinct files read within the group", () => {
    const first = makeSessionEvent({
      action_type: "tool_call",
      function: "read_file",
      uiCanonical: "read_file",
      args: { file_path: "src/app.ts" },
    });
    const second = makeSessionEvent({
      action_type: "tool_call",
      function: "read_file",
      uiCanonical: "read_file",
      args: { file_path: "src/styles.css" },
    });

    expect(countActivities([first, second], "read")).toBe(2);
  });
});
