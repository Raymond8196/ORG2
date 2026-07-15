# Remote Native Workspace Architecture Audit

Scope: local Rust-native agent with a provider key, system SSH authentication, and a remote working directory.

| Layer                 | Verdict | Evidence / decision                                                                                                                                                     |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation        | keep    | `cargo check` and targeted Rust tests pass.                                                                                                                             |
| 2. Structure          | keep    | `ExecTarget` remains the single shared target type; no second SSH credential model was introduced.                                                                      |
| 3. Naming             | keep    | `exec_target` keeps its existing wire name. `remote_workspace` names the tool-routing concern rather than the agent brain.                                              |
| 4. Semantics          | keep    | `exec_target` means CLI process placement for CLI sessions and remote tool workspace for Rust sessions; comments at both boundaries state this intentional distinction. |
| 5. Defaults           | keep    | Missing / malformed persisted targets deserialize to `Local`; existing rows retain local behavior.                                                                      |
| 6. Boundaries         | keep    | SSH command construction is confined to `ExecTool`; session initialization only selects the backend and tool availability.                                              |
| 7. Developer clarity  | keep    | Remote sessions explicitly expose only `run_shell`; its LLM description explains the remote directory and unsupported interactive/background modes.                     |
| 8. Wire / storage     | keep    | `exec_target` is serialized once to the session row and reappears in aggregate session results. A round-trip test covers it.                                            |
| 9. Init parity        | keep    | Fresh launch and resumed initialization both read the persisted target before tool registration. Routine and sub-agent launch paths explicitly default to local.        |
| 10. Resolver symmetry | keep    | Host and optional port travel together in `SshTarget`; workspace path is sourced from the same launch payload on first run and after restart.                           |

## Deliberate limits

- The model/runtime stays local. This is not a remote agent daemon.
- Remote sessions support blocking, non-interactive `run_shell` only.
- Local file APIs, LSP, Code Map, worktree, plan-file creation, and shell background polling are disabled for remote sessions so they cannot accidentally operate on a local path matching the remote directory.
- SSH authentication remains entirely system-managed (`~/.ssh/config`, agent, or key file); no keys are stored by ORG-II.

## Sweep performed

- All `AgentRunLaunchRequest` constructors set an explicit target (user launches forward the requested target; routines/work-item subagents default local).
- All `ToolDeps` constructors set the new backend field.
- Session upsert/select/test schema paths include `exec_target`.
