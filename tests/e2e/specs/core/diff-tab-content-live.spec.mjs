/* global describe, before, after, it, browser */
/**
 * diff-tab-content-live.spec.mjs
 *
 * LIVE-LLM coverage for the orgtrack final-diff → Diff-tab content render
 * path. The seeded spec (diff-tab-content-render.spec.mjs) proves
 * `finalDiffToSection` parses a `diff`-only record into a non-blank panel,
 * but it writes the backend record via the debug wire. This spec closes the
 * integration gap: a REAL agent turn edits a file in the repo, the orgtrack
 * extraction/backfill worker consolidates the change into a real
 * SessionFinalDiffRecord, and the Diff app must render the agent's actual
 * edited content (sentinel line) — no debug-seed anywhere.
 *
 * Per feedback_live_test_auto_behaviors: backend-authoritative data paths
 * (here: the orgtrack consolidation worker that feeds the Diff tab) need a
 * real-provider live spec, not just unit tests + seeded fixtures.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { hasAuthoritativeRunningTurn } from "../../support/core/session/agentQueuedControlScenarios.mjs";
import {
  configureScenario,
  execJS,
  filteredConfigs,
  invokeE2E,
  listAccounts,
  rustAgentConfigs,
  scenarioConfigs,
  stopActiveTurnIfNeeded,
  typeAndClickSend,
  unwrap,
  waitForApp,
  waitForChatLaunched,
} from "../../support/core/session/agentQueuedFollowupDriver.mjs";

const RUN_ID = Date.now();
const CHAT_INPUT = '[data-testid="chat-input"] [contenteditable="true"]';
const LIVE_TIMEOUT_MS = 300_000;
const DIFF_RENDER_TIMEOUT_MS = 120_000;
const LIVE_CLI_TIMEOUT_MS = 300_000;

function execFileWithClosedStdin(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    // Codex 0.144 reads piped stdin even when PROMPT is positional, appending
    // it as a <stdin> block. Node keeps this pipe open unless we close it,
    // which otherwise leaves `codex exec` waiting forever before its turn.
    child.stdin?.end();
  });
}

async function pointerClick(selector, label, timeout = 60_000) {
  let point = null;
  await browser.waitUntil(
    async () => {
      point = await browser.executeScript(
        `
          const selector = arguments[0];
          const candidates = [...document.querySelectorAll(selector)].filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
          const element = candidates[candidates.length - 1] ?? null;
          if (!element) return { ok: false, reason: "missing", selector };
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const x = Math.floor(rect.left + rect.width / 2);
          const y = Math.floor(rect.top + rect.height / 2);
          const hit = document.elementFromPoint(x, y);
          return {
            ok: hit === element || Boolean(hit?.closest?.(selector)),
            selector,
            x,
            y,
            hit: hit?.getAttribute?.("data-testid") ?? hit?.tagName ?? null,
          };
        `,
        [selector]
      );
      return point?.ok === true;
    },
    {
      timeout,
      interval: 250,
      timeoutMsg: `${label} not pointer-clickable: ${JSON.stringify(point)}`,
    }
  );
  await browser
    .action("pointer")
    .move({ x: point.x, y: point.y })
    .down()
    .up()
    .perform();
}

async function visibleChatTranscriptSnapshot() {
  return execJS(`
    const roots = [...document.querySelectorAll('[data-chat-view-root]')];
    const root = roots.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }) ?? null;
    const transcript = root?.querySelector('[data-testid="chat-message-list"]') ?? null;
    return {
      sessionId: root?.getAttribute('data-session-id') ?? null,
      text: (transcript?.innerText || transcript?.textContent || '').trim(),
      historyCount: Number(transcript?.getAttribute('data-chat-history-count') || '0'),
    };
  `);
}

// Unique sentinel the agent must write; asserted in the rendered diff panel.
const SENTINEL = `DIFF_LIVE_SENTINEL_${RUN_ID}`;
const CLAUDE_SENTINEL = `CLAUDE_PROVENANCE_${RUN_ID}`;
const CODEX_SENTINEL = `CODEX_PROVENANCE_${RUN_ID}`;
const CURSOR_SENTINEL = `CURSOR_PROVENANCE_${RUN_ID}`;
const TARGET_FILE = `diff-live-${RUN_ID}.ts`;
// A single rendered code row taller than this means a line stretched the
// layout instead of scrolling — the "giant row" artifact regressed.
const MAX_SANE_LINE_HEIGHT_PX = 80;

function hookConfigContainsMarker(path) {
  return (
    existsSync(path) &&
    readFileSync(path, "utf8").includes("--session-provenance-hook")
  );
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function provenanceRowsForFile(orgiiHome, filePath) {
  const databasePath = join(orgiiHome, "sessions.db");
  if (!existsSync(databasePath)) return [];
  const sql = `
    SELECT interaction.session_id AS sessionId,
           interaction.source AS source,
           interaction.action AS action,
           interaction.turn_id AS turnId,
           interaction.actor_id AS actorId,
           interaction.capture_method AS captureMethod,
           interaction.attribution_precision AS attributionPrecision,
           interaction.payload_json AS payload
    FROM orgtrack_core_resource_interactions interaction
    JOIN orgtrack_core_file_resources file_resource
      ON file_resource.resource_id = interaction.resource_id
    WHERE file_resource.repo_relative_path = ${sqlLiteral(filePath)}
    ORDER BY interaction.occurred_at ASC;
  `;
  const { stdout } = await execFileWithClosedStdin(
    "sqlite3",
    ["-json", databasePath, sql],
    {
      maxBuffer: 2 * 1024 * 1024,
    }
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function finalDiffCountForSession(orgiiHome, sessionId) {
  const databasePath = join(orgiiHome, "sessions.db");
  if (!existsSync(databasePath)) return 0;
  const sql = `
    SELECT COUNT(*)
    FROM orgtrack_core_final_diffs
    WHERE source = 'orgii_rust_agents'
      AND session_id = ${sqlLiteral(sessionId)};
  `;
  const { stdout } = await execFileWithClosedStdin(
    "sqlite3",
    [databasePath, sql],
    { maxBuffer: 1024 * 1024 }
  );
  return Number(stdout.trim() || "0");
}

async function runClaudeCodeProvenance(repoPath) {
  const prompt = [
    "Use the Task tool exactly once to delegate all file work to a general-purpose subagent.",
    `Tell that subagent to use Read on ${TARGET_FILE}, then use Edit to append exactly this new final line: // ${CLAUDE_SENTINEL}`,
    "The parent must not read or edit the file itself. Wait for the subagent, then stop.",
  ].join(" ");
  const { stdout, stderr } = await execFileWithClosedStdin(
    "claude",
    [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--permission-mode",
      "bypassPermissions",
      "--tools",
      "Task,Read,Edit",
      "--name",
      `ORG2 provenance E2E ${RUN_ID}`,
    ],
    {
      cwd: repoPath,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
      timeout: LIVE_CLI_TIMEOUT_MS,
    }
  );
  const result = JSON.parse(stdout.trim());
  if (!result.session_id) {
    throw new Error(
      `Claude Code did not return a session id; stderr=${stderr.slice(-1000)}`
    );
  }
  return { sessionId: result.session_id, prompt };
}

async function runCodexProvenance(repoPath) {
  const prompt = [
    `Use exec_command to run exactly: sed -n '1,40p' ${TARGET_FILE}`,
    `Then use apply_patch to append exactly this new final line: // ${CODEX_SENTINEL}`,
    "Do not change any existing line. Use no other tools, then stop.",
  ].join(" ");
  const { stdout, stderr } = await execFileWithClosedStdin(
    "codex",
    [
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--dangerously-bypass-hook-trust",
      "-C",
      repoPath,
      prompt,
    ],
    {
      cwd: repoPath,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: LIVE_CLI_TIMEOUT_MS,
    }
  );
  const events = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const started = events.find((event) => event.type === "thread.started");
  if (!started?.thread_id) {
    throw new Error(
      `Codex did not return a thread id; stderr=${stderr.slice(-1000)}`
    );
  }
  return { sessionId: started.thread_id, prompt };
}

async function runCursorProvenance(repoPath) {
  const prompt = [
    `First read ${TARGET_FILE} using the file read tool.`,
    `Then edit it with a file editing tool by appending exactly this new final line: // ${CURSOR_SENTINEL}`,
    "Do not change any existing line. Use no other tools, then stop.",
  ].join(" ");
  const { stdout, stderr } = await execFileWithClosedStdin(
    process.env.CURSOR_AGENT_BIN ?? "agent",
    [
      "-p",
      "--output-format",
      "json",
      "--trust",
      "--force",
      "--workspace",
      repoPath,
      prompt,
    ],
    {
      cwd: repoPath,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
      timeout: LIVE_CLI_TIMEOUT_MS,
    }
  );
  const result = JSON.parse(stdout.trim());
  if (!result.session_id) {
    throw new Error(
      `Cursor Agent did not return a session id; stderr=${stderr.slice(-1000)}`
    );
  }
  return { sessionId: result.session_id, prompt };
}

async function switchToMyStationCodeEditor() {
  unwrap(
    await invokeE2E("navigateTo", "/orgii/workstation/code"),
    "navigate to My Station Code Editor"
  );
  // tauri-wd currently cannot serialize this React-owned element for
  // waitForDisplayed/click (Node.contains receives a cross-realm wrapper).
  // This mode switch is deterministic setup; critical timeline interactions
  // below remain real WebDriver clicks.
  const stationSwitch = await execJS(`
    const button = document.querySelector('[data-testid="station-mode-my-station"]');
    if (!button) return 'missing';
    button.click();
    return 'clicked';
  `);
  expect(stationSwitch).toBe("clicked");
  await browser.waitUntil(
    async () => {
      const surface = unwrap(
        await invokeE2E("inspectWorkstationSurface"),
        "inspect My Station route"
      );
      return (
        surface.pathname === "/orgii/workstation/code" &&
        surface.stationMode === "my-station"
      );
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: "My Station route never became active",
    }
  );
}

async function openFileTimeline(repoPath) {
  const absoluteFilePath = join(repoPath, TARGET_FILE);
  unwrap(
    await invokeE2E("openWorkstationFile", absoluteFilePath),
    "open target file in My Station"
  );

  // The workstation host is tab-driven rather than route-driven. Opening the
  // file above creates/focuses the code tab, which is what mounts CodeEditor.
  await browser.waitUntil(
    async () =>
      execJS(`
        const panel = document.querySelector('.code-editor-right-panel');
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        const style = window.getComputedStyle(panel);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      `),
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg:
        "My Station Code Editor never rendered after opening the file tab",
    }
  );

  const toggleSelector = '[data-testid="code-editor-timeline-section-toggle"]';
  await browser.waitUntil(
    async () =>
      execJS(`
        const toggle = document.querySelector(${JSON.stringify(
          toggleSelector
        )});
        if (!toggle) return false;
        const rect = toggle.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      `),
    {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: async () =>
        `Timeline section did not mount after opening the target file; state=${JSON.stringify(
          unwrap(
            await invokeE2E("inspectChatState"),
            "inspectChatState(missing Timeline)"
          )
        )}`,
    }
  );
  const collapsed = await execJS(`
    return document.querySelector(${JSON.stringify(
      toggleSelector
    )})?.getAttribute('data-collapsed') ?? null;
  `);
  if (collapsed === "false") {
    await pointerClick(toggleSelector, "collapse Timeline section", 30_000);
    await browser.waitUntil(
      async () =>
        execJS(`
          return document.querySelector(${JSON.stringify(
            toggleSelector
          )})?.getAttribute('data-collapsed') === 'true';
        `),
      { timeout: 10_000, interval: 250 }
    );
  }
  await pointerClick(toggleSelector, "expand Timeline section", 30_000);
  await browser.waitUntil(
    async () =>
      execJS(`
        return document.querySelector(${JSON.stringify(
          toggleSelector
        )})?.getAttribute('data-collapsed') === 'false';
      `),
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: "Timeline pointer click did not expand the section",
    }
  );
  try {
    await browser.waitUntil(
      async () =>
        execJS(
          "return Boolean(document.querySelector('[data-testid=\"session-blame-section\"]'));"
        ),
      { timeout: 60_000, interval: 500 }
    );
  } catch {
    const timeline = await execJS(`
      const toggle = document.querySelector(${JSON.stringify(toggleSelector)});
      const section = toggle?.parentElement?.parentElement;
      return {
        togglePresent: Boolean(toggle),
        collapsed: toggle?.getAttribute('data-collapsed') ?? null,
        sectionText: (section?.innerText || section?.textContent || '').slice(0, 1200),
        sectionHtml: (section?.innerHTML || '').slice(0, 1200),
        bodyTail: (document.body.innerText || '').slice(-1200),
      };
    `);
    throw new Error(
      `Session Blame section never rendered; timeline=${JSON.stringify(timeline)}`
    );
  }
}

async function diffPanelSnapshot() {
  return execJS(`
    const replay = document.querySelector('.session-replay-diff');
    if (!replay) {
      return {
        hasReplayShell: false,
        replayText: '',
        bodyTail: (document.body.innerText || '').slice(-1500),
      };
    }
    const editors = replay.querySelectorAll('.cm-editor');
    let maxLineHeight = 0;
    let maxLineSample = '';
    for (const line of replay.querySelectorAll('.cm-line')) {
      const h = line.getBoundingClientRect().height;
      if (h > maxLineHeight) {
        maxLineHeight = h;
        maxLineSample = (line.innerText || '').slice(0, 60);
      }
    }
    const sectionButtons = Array.from(replay.querySelectorAll('button'))
      .filter((b) => (b.innerText || '').includes(${JSON.stringify(TARGET_FILE)}));
    return {
      hasReplayShell: true,
      editorCount: editors.length,
      sectionButtonCount: sectionButtons.length,
      maxLineHeight: Math.round(maxLineHeight),
      maxLineSample,
      replayText: replay.innerText || '',
      bodyTail: (document.body.innerText || '').slice(-1500),
    };
  `);
}

// Click the file-section header toggle (chevron button labeled with the
// file name) so we can prove the section is collapsible.
async function toggleLiveFileSection() {
  return execJS(`
    const replay = document.querySelector('.session-replay-diff') || document;
    const btn = Array.from(replay.querySelectorAll('button'))
      .find((b) => (b.innerText || '').includes(${JSON.stringify(TARGET_FILE)}));
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  `);
}

describe("Diff tab content live (real agent edit → orgtrack final-diff)", () => {
  let config = null;
  let repoPath = null;
  let orgiiHome = null;
  let nativeSessionId = null;

  before(async function () {
    await waitForApp();
    const accounts = await listAccounts();
    try {
      const rustConfigs = rustAgentConfigs(
        filteredConfigs(scenarioConfigs(accounts))
      );
      config =
        rustConfigs.find((row) => row.label === "claude-code-rust-agent") ??
        rustConfigs[0] ??
        null;
    } catch (error) {
      // External CLI provenance is independently runnable. A missing ORG2
      // native-provider account blocks only the first live-Diff scenario;
      // it must not suppress real Claude/Codex/Cursor hook + UI coverage.
      console.warn(
        `[diff-tab-content-live] native ORG2 provider blocked: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    repoPath = process.env.E2E_REPO_PATH;
    if (!repoPath) throw new Error("E2E_REPO_PATH missing");
    orgiiHome = process.env.ORGII_HOME;
    if (!orgiiHome) throw new Error("ORGII_HOME missing for isolated E2E run");
  });

  after(async () => {
    await stopActiveTurnIfNeeded("diff-tab-content-live-cleanup");
  });

  it("renders the agent's real edited content in the Diff tab", async function () {
    if (!config) {
      this.skip();
      return;
    }
    unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath }),
      "ensureRepoSelected(diff provenance live)"
    );
    await configureScenario(config, { agentExecMode: "build" });

    const prompt = [
      `Create a new file named ${TARGET_FILE} in the repository root`,
      `(${repoPath}). The file must contain exactly this single line of`,
      `TypeScript: export const marker = "${SENTINEL}";`,
      `Use your edit_file / file-write tool to create it. Then use your`,
      `read-file tool to read the new file back and stop.`,
    ].join(" ");

    await typeAndClickSend(CHAT_INPUT, prompt);
    await waitForChatLaunched(prompt);

    // 1. Backend truth: the real agent turn wrote the file to disk. Only a
    //    live tool call could produce it (no seed path touches the fs).
    await browser.waitUntil(
      async () => existsSync(join(repoPath, TARGET_FILE)),
      {
        timeout: LIVE_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: async () =>
          `agent never created ${TARGET_FILE}; tail=${JSON.stringify(
            (await diffPanelSnapshot()).bodyTail
          )}`,
      }
    );

    // File creation can precede the turn-finalization worker by a fraction of
    // a second. Wait for the authoritative turn and production final-diff RPC
    // before mounting Diff; its initial load is intentionally not a poller.
    await browser.waitUntil(
      async () => {
        const state = unwrap(
          await invokeE2E("inspectChatState"),
          "inspectChatState(native provenance pre-Diff)"
        );
        nativeSessionId = state.activeSessionId;
        return Boolean(nativeSessionId) && !hasAuthoritativeRunningTurn(state);
      },
      {
        timeout: LIVE_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: "native ORG2 turn never settled after writing and reading",
      }
    );
    await browser.waitUntil(
      async () =>
        (await finalDiffCountForSession(orgiiHome, nativeSessionId)) > 0,
      {
        timeout: DIFF_RENDER_TIMEOUT_MS,
        interval: 1_000,
        timeoutMsg: "native ORG2 final diff never became authoritative",
      }
    );

    // 2. Open the Diff app (same atoms as the product "View in Agent
    //    station" / files-pill click path).
    await browser.waitUntil(
      async () => (await invokeE2E("openAgentStationDiff")).ok === true,
      {
        timeout: 30_000,
        interval: 1_000,
        timeoutMsg: "openAgentStationDiff never succeeded",
      }
    );

    await browser.waitUntil(
      async () => (await diffPanelSnapshot()).hasReplayShell,
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "Diff replay shell never mounted",
      }
    );

    // 3. The Diff tab must render the agent's REAL edited content. This is
    //    the orgtrack final-diff path: the extraction/backfill worker
    //    consolidated the live edit into a SessionFinalDiffRecord, and
    //    finalDiffToSection rendered it. Before the fix a diff-only record
    //    produced a blank panel; here the sentinel must be visible.
    let snap = null;
    await browser.waitUntil(
      async () => {
        snap = await diffPanelSnapshot();
        return snap.replayText.includes(SENTINEL) && snap.editorCount > 0;
      },
      {
        timeout: DIFF_RENDER_TIMEOUT_MS,
        interval: 2_000,
        timeoutMsg: async () =>
          `live diff content never rendered the sentinel; snapshot=${JSON.stringify(
            await diffPanelSnapshot()
          )}`,
      }
    );

    // 3a. Structural health on the LIVE render: no single code row may be
    //     absurdly tall (the "giant row" artifact). The live path does not
    //     guarantee a collapse band (depends on file size), so we only
    //     assert the universal invariants here; the collapse-band + expand
    //     coverage lives in the seeded spec which controls the diff shape.
    expect(snap.maxLineHeight).toBeLessThan(MAX_SANE_LINE_HEIGHT_PX);

    // 3b. The file section is collapsible: clicking its header toggle hides
    //     the editor, clicking again restores it — the same collapsible
    //     chevron the user operates.
    expect(snap.sectionButtonCount).toBeGreaterThan(0);
    unwrap(
      (await toggleLiveFileSection()).clicked
        ? { ok: true }
        : { ok: false, error: "file section toggle not found" },
      "toggleLiveFileSection(collapse)"
    );
    await browser.waitUntil(
      async () => (await diffPanelSnapshot()).editorCount === 0,
      {
        timeout: 10_000,
        interval: 400,
        timeoutMsg: "live file section never collapsed (editor still mounted)",
      }
    );
    unwrap(
      (await toggleLiveFileSection()).clicked
        ? { ok: true }
        : { ok: false, error: "file section toggle not found" },
      "toggleLiveFileSection(expand)"
    );
    await browser.waitUntil(
      async () => (await diffPanelSnapshot()).editorCount > 0,
      {
        timeout: 10_000,
        interval: 400,
        timeoutMsg: "live file section never re-expanded",
      }
    );

    expect(nativeSessionId).toBeTruthy();
  });

  it("renders and opens live Claude Code, Codex, and Cursor session provenance", async function () {
    this.timeout(900_000);
    unwrap(
      await invokeE2E("ensureRepoSelected", { repoPath }),
      "ensureRepoSelected(external session provenance)"
    );
    if (!existsSync(join(repoPath, TARGET_FILE))) {
      // Deterministic setup only. Every claimed provenance fact below still
      // comes from a real vendor tool invocation, production hook, store,
      // query, rendered row, and pointer click.
      writeFileSync(
        join(repoPath, TARGET_FILE),
        `export const marker = "${SENTINEL}";\n`,
        "utf8"
      );
    }
    const claudeHooks = join(homedir(), ".claude", "settings.json");
    const codexHooks = join(homedir(), ".codex", "hooks.json");
    const cursorHooks = join(homedir(), ".cursor", "hooks.json");
    await browser.waitUntil(
      async () =>
        hookConfigContainsMarker(claudeHooks) &&
        hookConfigContainsMarker(codexHooks) &&
        hookConfigContainsMarker(cursorHooks),
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg:
          "ORG2 did not install the Claude Code, Codex, and Cursor hooks",
      }
    );

    const claude = await runClaudeCodeProvenance(repoPath);
    await browser.waitUntil(
      async () =>
        readFileSync(join(repoPath, TARGET_FILE), "utf8").includes(
          CLAUDE_SENTINEL
        ),
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "Claude Code did not append its provenance sentinel",
      }
    );

    const codex = await runCodexProvenance(repoPath);
    await browser.waitUntil(
      async () =>
        readFileSync(join(repoPath, TARGET_FILE), "utf8").includes(
          CODEX_SENTINEL
        ),
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "Codex did not append its provenance sentinel",
      }
    );

    const cursor = await runCursorProvenance(repoPath);
    await browser.waitUntil(
      async () =>
        readFileSync(join(repoPath, TARGET_FILE), "utf8").includes(
          CURSOR_SENTINEL
        ),
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "Cursor Agent did not append its provenance sentinel",
      }
    );

    let rows = [];
    await browser.waitUntil(
      async () => {
        rows = await provenanceRowsForFile(orgiiHome, TARGET_FILE);
        const actionsBySource = new Map();
        for (const row of rows) {
          const actions = actionsBySource.get(row.source) ?? new Set();
          actions.add(row.action);
          actionsBySource.set(row.source, actions);
        }
        const expectedSources = ["claude_code", "codex_app", "cursor_ide"];
        if (nativeSessionId) expectedSources.push("orgii_rust_agents");
        return expectedSources.every(
          (source) =>
            actionsBySource.get(source)?.has("read") &&
            actionsBySource.get(source)?.has("write")
        );
      },
      {
        timeout: 90_000,
        interval: 2_000,
        timeoutMsg: async () =>
          `live read/write provenance never converged; rows=${JSON.stringify(
            await provenanceRowsForFile(orgiiHome, TARGET_FILE)
          )}`,
      }
    );

    if (nativeSessionId) {
      expect(
        rows.some(
          (row) =>
            row.source === "orgii_rust_agents" &&
            row.sessionId === nativeSessionId &&
            row.captureMethod === "native"
        )
      ).toBe(true);
    }
    expect(
      rows.some(
        (row) =>
          row.source === "claude_code" &&
          row.sessionId.endsWith(claude.sessionId) &&
          row.actorId &&
          row.captureMethod === "hook" &&
          row.attributionPrecision === "exact"
      )
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.source === "codex_app" &&
          row.sessionId.endsWith(codex.sessionId) &&
          row.turnId &&
          row.captureMethod === "hook" &&
          row.attributionPrecision === "session_only"
      )
    ).toBe(true);
    expect(
      rows.some(
        (row) =>
          row.source === "cursor_ide" &&
          row.sessionId.endsWith(cursor.sessionId) &&
          row.turnId === cursor.sessionId &&
          row.captureMethod === "hook" &&
          row.attributionPrecision === "session_only"
      )
    ).toBe(true);

    const serializedPayloads = rows.map((row) => row.payload).join("\n");
    for (const privateValue of [
      SENTINEL,
      CLAUDE_SENTINEL,
      CODEX_SENTINEL,
      CURSOR_SENTINEL,
    ]) {
      expect(serializedPayloads).not.toContain(privateValue);
    }

    const firstHistoryReadStartedAt = Date.now();
    const firstWireHistory = unwrap(
      await invokeE2E("inspectOrgtrackFileSessionHistory", {
        repoPath,
        filePath: TARGET_FILE,
      }),
      "inspect production file session history"
    ).history;
    expect(Date.now() - firstHistoryReadStartedAt).toBeLessThan(5_000);
    expect([
      "queued",
      "discovering",
      "indexing",
      "complete",
      "partial",
    ]).toContain(firstWireHistory.backfill.status);

    const expectedSources = ["claude_code", "codex_app", "cursor_ide"];
    if (nativeSessionId) expectedSources.push("orgii_rust_agents");
    let wireHistory = firstWireHistory;
    await browser.waitUntil(
      async () => {
        wireHistory = unwrap(
          await invokeE2E("inspectOrgtrackFileSessionHistory", {
            repoPath,
            filePath: TARGET_FILE,
          }),
          "poll production file session history"
        ).history;
        const terminal = ["complete", "partial"].includes(
          wireHistory.backfill.status
        );
        return (
          terminal &&
          expectedSources.every((source) =>
            wireHistory.sessions.some((session) => session.source === source)
          )
        );
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          "historical Session Blame backfill did not reach terminal coverage",
      }
    );
    for (const source of expectedSources) {
      expect(
        wireHistory.sessions.some((session) => session.source === source)
      ).toBe(true);
    }
    const claudeWireChild = wireHistory.sessions
      .filter((session) => session.source === "claude_code")
      .flatMap((session) =>
        session.participants.map((participant) => ({ session, participant }))
      )
      .find(
        ({ session, participant }) =>
          participant.participantKind === "subagent" &&
          participant.parentSessionId === session.sessionId &&
          participant.sessionId !== session.sessionId
    );
    expect(claudeWireChild).toBeTruthy();
    expect(claudeWireChild.session.sessionId).toMatch(
      new RegExp(`${claude.sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
    );

    await switchToMyStationCodeEditor();
    await openFileTimeline(repoPath);

    const rendered = await execJS(`
      return [...document.querySelectorAll('[data-testid="session-blame-entry"]')].map((row) => ({
        source: row.getAttribute('data-session-source'),
        sessionId: row.getAttribute('data-session-id'),
        originSessionId: row.getAttribute('data-origin-session-id'),
        participantKind: row.getAttribute('data-participant-kind'),
        actorId: row.getAttribute('data-actor-id'),
        precision: row.getAttribute('data-attribution-precision'),
        readCount: Number(row.getAttribute('data-read-count') || '0'),
        writeCount: Number(row.getAttribute('data-write-count') || '0'),
        text: row.innerText || row.textContent || '',
      }));
    `);
    for (const source of expectedSources) {
      const entry = rendered.find((row) => row.source === source);
      expect(entry).toBeTruthy();
      expect(entry.readCount).toBeGreaterThan(0);
      expect(entry.writeCount).toBeGreaterThan(0);
    }

    const claudeSubagent = rendered.find(
      (row) => row.source === "claude_code" && row.actorId
    );
    expect(claudeSubagent).toBeTruthy();
    expect(claudeSubagent.participantKind).toBe("subagent");
    expect(claudeSubagent.precision).toBe("exact");
    expect(claudeSubagent.sessionId).not.toBe(claudeSubagent.originSessionId);
    // The visible role/precision labels are localized. Assert the stable
    // semantic attributes above and participant-specific content here so the
    // scenario remains valid in every supported UI language.
    expect(claudeSubagent.text).toContain(TARGET_FILE);

    const claudeRootSessionId = claudeWireChild.session.sessionId;
    const claudeChildSessionId = claudeWireChild.participant.sessionId;
    await pointerClick(
      `[data-testid="session-blame-session"][data-session-id="${claudeRootSessionId}"] [data-testid="session-blame-session-header"]`,
      "Claude root Session Blame entry"
    );
    let rootTranscript = null;
    await browser.waitUntil(
      async () => {
        const state = unwrap(
          await invokeE2E("inspectChatState"),
          "inspectChatState(after root Session Blame click)"
        );
        rootTranscript = await visibleChatTranscriptSnapshot();
        return (
          state.activeSessionId === claudeRootSessionId &&
          rootTranscript.sessionId === claudeRootSessionId &&
          rootTranscript.historyCount > 0 &&
          rootTranscript.text.length > 0
        );
      },
      {
        timeout: 90_000,
        interval: 1_000,
        timeoutMsg: async () =>
          `root Session Blame entry did not render its own transcript; snapshot=${JSON.stringify(await visibleChatTranscriptSnapshot())}`,
      }
    );

    // Reopen the same file while the root session tab is active. Clicking the
    // child must repoint that tab; merely changing activeSessionId is not a
    // sufficient navigation proof because ChatView renders from tab.sessionId.
    await switchToMyStationCodeEditor();
    await openFileTimeline(repoPath);
    await pointerClick(
      `[data-testid="session-blame-entry"][data-session-id="${claudeChildSessionId}"]`,
      "Claude subagent Session Blame entry"
    );
    let childTranscript = null;
    await browser.waitUntil(
      async () => {
        const state = unwrap(
          await invokeE2E("inspectChatState"),
          "inspectChatState(after Session Blame click)"
        );
        childTranscript = await visibleChatTranscriptSnapshot();
        return (
          state.activeSessionId === claudeChildSessionId &&
          childTranscript.sessionId === claudeChildSessionId &&
          childTranscript.historyCount > 0 &&
          childTranscript.text.length > 0
        );
      },
      {
        timeout: 90_000,
        interval: 1_000,
        timeoutMsg: async () =>
          `subagent Session Blame entry did not render its own transcript; snapshot=${JSON.stringify(await visibleChatTranscriptSnapshot())}`,
      }
    );
    expect(childTranscript.text).toContain(TARGET_FILE);
    expect(childTranscript.text).not.toBe(rootTranscript.text);
  });
});
