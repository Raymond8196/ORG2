import { describe, expect, it } from "vitest";

import {
  basenameFromPath,
  buildRemoteTargetDisplay,
  remoteTargetFromExecTarget,
} from "./remoteTargetDisplay";

describe("remoteTargetDisplay", () => {
  it("builds compact host and workspace labels for remote execution", () => {
    expect(
      buildRemoteTargetDisplay({
        host: "qlg@172.16.10.239",
        workspacePath: "/home/qlg/wkspaces/ORG2",
      })
    ).toEqual({
      hostLabel: "qlg@172.16.10.239",
      workspaceLabel: "ORG2",
      title: "qlg@172.16.10.239 · /home/qlg/wkspaces/ORG2",
    });
  });

  it("includes a non-default ssh port in the host label", () => {
    expect(
      buildRemoteTargetDisplay({
        host: "devbox",
        port: 2222,
        workspacePath: "/repo/app/",
      })?.hostLabel
    ).toBe("devbox:2222");
  });

  it("extracts the final segment from a unix path", () => {
    expect(basenameFromPath("/home/qlg/wkspaces/ORG2/")).toBe("ORG2");
  });

  it("extracts remote host data from execTarget without treating local as remote", () => {
    expect(
      remoteTargetFromExecTarget({
        remote: { host: "qlg@172.16.10.239", port: 2222 },
      })
    ).toEqual({ host: "qlg@172.16.10.239", port: 2222 });
    expect(remoteTargetFromExecTarget("local")).toBeNull();
    expect(remoteTargetFromExecTarget({ local: null })).toBeNull();
  });
});
