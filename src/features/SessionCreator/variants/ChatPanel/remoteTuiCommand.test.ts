import {
  buildRemoteTuiCommand,
  buildRemoteTuiScript,
} from "./remoteTuiCommand";

describe("buildRemoteTuiCommand", () => {
  it("uses an interactive remote bash so the user's bashrc env is loaded", () => {
    const command = buildRemoteTuiCommand({
      command: "codex",
      host: "qlg@172.16.10.239",
      workingDir: "/home/qlg/wkspaces/ORG2",
    });

    const script = buildRemoteTuiScript({
      command: "codex",
      workingDir: "/home/qlg/wkspaces/ORG2",
    });

    expect(command).toContain("ssh -tt");
    expect(command).toContain("bash -ic");
    expect(command).not.toContain("bash -lc");
    expect(script).toContain("cd '/home/qlg/wkspaces/ORG2' && exec codex");
  });

  it("sets a UTF-8 locale fallback for remote TUI input", () => {
    const script = buildRemoteTuiScript({
      command: "claude",
    });

    expect(script).toContain("LANG=C.UTF-8");
    expect(script).toContain("LC_CTYPE=");
  });

  it("preserves ssh port and shell quoting", () => {
    const command = buildRemoteTuiCommand({
      command: "claude",
      host: "user@host",
      port: 2222,
      workingDir: "/tmp/has 'quote'",
    });
    const script = buildRemoteTuiScript({
      command: "claude",
      workingDir: "/tmp/has 'quote'",
    });

    expect(command).toContain("-p 2222");
    expect(script).toContain("cd '/tmp/has '\\''quote'\\''' && exec claude");
  });
});
