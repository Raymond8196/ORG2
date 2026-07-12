//! Unified CLI Session Scanner
//!
//! Config-driven scanner for AI CLI tools: Codex, Gemini CLI, Kiro CLI, Aider.
//! Each tool gets a `CliToolConfig` describing where sessions live and how to parse them.
//!
//! Claude Code has its own dedicated scanner (`claude_code_db.rs`) because its
//! format is more complex (sessions-index.json + per-session JSONL).
//!
//! ## Supported Tools
//!
//! | Tool       | Session Dir                              | Format                    |
//! |------------|------------------------------------------|---------------------------|
//! | Codex      | `~/.codex/sessions/YYYY/MM/DD/*.jsonl`   | rollout JSONL             |
//! | Gemini CLI | `~/.gemini/tmp/*/chats/*`                | chat JSON                 |
//! | Kiro CLI   | `~/.kiro/sessions/`                      | session JSON              |
//! | Aider      | `~/.aider/history/`                      | chat history              |
//!
//! ## Caching
//!
//! All parsed sessions are cached in `cli_session_cache` table (shared across tools).
//! Delta-sync uses file mtime to skip unchanged sessions.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use chrono::TimeZone;

static LAST_SYNC: Mutex<Option<Instant>> = Mutex::new(None);
const SYNC_COOLDOWN: Duration = Duration::from_secs(60);

/// Bump this when parser logic changes to force re-scan of all sessions.
///
/// v3: replaced hand-rolled substring JSON extraction with real `serde_json`
/// parsing in every per-tool scanner (robust against nested/escaped JSON) and
/// fixed Aider message counting.
const PARSER_VERSION: i32 = 3;

// ============================================
// Types
// ============================================

/// Identifies which CLI tool a session belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CliTool {
    Codex,
    Gemini,
    Kiro,
    Aider,
    CursorCli,
}

impl CliTool {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Kiro => "kiro",
            Self::Aider => "aider",
            Self::CursorCli => "cursor_cli",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Gemini => "Gemini CLI",
            Self::Kiro => "Kiro CLI",
            Self::Aider => "Aider",
            Self::CursorCli => "Cursor CLI",
        }
    }

    pub fn from_str_value(value: &str) -> Option<Self> {
        match value {
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            "kiro" => Some(Self::Kiro),
            "aider" => Some(Self::Aider),
            "cursor_cli" => Some(Self::CursorCli),
            _ => None,
        }
    }
}

/// A unified session record returned to the frontend.
/// Works for all CLI tools — fields that don't apply are left as defaults.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSession {
    pub id: String,
    pub tool: CliTool,
    pub name: String,
    pub created_at: i64,
    pub last_active_at: i64,
    pub message_count: i32,
    pub model: String,
    pub workspace_path: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// List-price estimate in USD, priced from `input_tokens`/`output_tokens`
    /// via the shared pricing catalog. Filled at the command boundary (this
    /// crate has no pricing dependency); `0.0` until then.
    #[serde(rename = "estimatedCost", default)]
    pub estimated_cost: f64,
    /// Metered spend recorded by the source. Always `0.0` for these imported
    /// CLI sources — they record no dollar figures.
    #[serde(rename = "recordedCost", default)]
    pub recorded_cost: f64,
}

// ============================================
// Tool Configs
// ============================================

struct CliToolConfig {
    tool: CliTool,
    dir_from_home: &'static str,
}

const CLI_TOOL_CONFIGS: &[CliToolConfig] = &[
    CliToolConfig {
        tool: CliTool::Codex,
        dir_from_home: ".codex",
    },
    CliToolConfig {
        tool: CliTool::Gemini,
        dir_from_home: ".gemini",
    },
    CliToolConfig {
        tool: CliTool::Kiro,
        dir_from_home: ".kiro",
    },
    CliToolConfig {
        tool: CliTool::Aider,
        dir_from_home: ".aider",
    },
    CliToolConfig {
        tool: CliTool::CursorCli,
        dir_from_home: ".cursor",
    },
];

// ============================================
// Public API
// ============================================

/// Query CLI sessions for a specific tool (or all tools) within a date range.
pub fn get_cli_sessions(
    cache_conn: &Connection,
    tool_filter: Option<&str>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<CliSession>, String> {
    delta_sync(cache_conn)?;
    query_cache(cache_conn, tool_filter, start_date, end_date)
}

// ============================================
// Delta Sync
// ============================================

fn delta_sync(cache_conn: &Connection) -> Result<(), String> {
    let now = Instant::now();
    if let Ok(guard) = LAST_SYNC.lock() {
        if let Some(last) = *guard {
            if now.duration_since(last) < SYNC_COOLDOWN {
                return Ok(());
            }
        }
    }

    // Clear stale cache entries when parser version changes
    invalidate_stale_cache(cache_conn)?;

    let home = match dirs::home_dir() {
        Some(dir) => dir,
        None => return Ok(()),
    };

    let cached_mtimes = get_cached_mtimes(cache_conn)?;

    for config in CLI_TOOL_CONFIGS {
        let tool_dir = home.join(config.dir_from_home);
        if !tool_dir.is_dir() {
            continue;
        }

        let sessions = match config.tool {
            CliTool::Codex => scan_codex_sessions(&tool_dir),
            CliTool::Gemini => scan_gemini_sessions(&tool_dir),
            CliTool::Kiro => scan_kiro_sessions(&tool_dir),
            CliTool::Aider => scan_aider_sessions(&tool_dir),
            CliTool::CursorCli => scan_cursor_cli_sessions(&tool_dir),
        };

        let new_sessions: Vec<CliSession> = sessions
            .into_iter()
            .filter(|session| match cached_mtimes.get(&session.id) {
                Some(&cached_mtime) => session.last_active_at > cached_mtime,
                None => true,
            })
            .collect();

        if !new_sessions.is_empty() {
            upsert_cache(cache_conn, &new_sessions)?;
        }
    }

    if let Ok(mut guard) = LAST_SYNC.lock() {
        *guard = Some(now);
    }

    Ok(())
}

// ============================================
// Codex Scanner (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// ============================================

fn scan_codex_sessions(codex_dir: &Path) -> Vec<CliSession> {
    let sessions_dir = codex_dir.join("sessions");
    if !sessions_dir.is_dir() {
        return Vec::new();
    }

    let mut sessions = Vec::new();

    // Walk YYYY/MM/DD directory structure
    for year_entry in fs::read_dir(&sessions_dir).into_iter().flatten().flatten() {
        if !year_entry.path().is_dir() {
            continue;
        }
        for month_entry in fs::read_dir(year_entry.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            if !month_entry.path().is_dir() {
                continue;
            }
            for day_entry in fs::read_dir(month_entry.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                if !day_entry.path().is_dir() {
                    continue;
                }
                for file_entry in fs::read_dir(day_entry.path())
                    .into_iter()
                    .flatten()
                    .flatten()
                {
                    let path = file_entry.path();
                    if path.extension().is_none_or(|ext| ext != "jsonl") {
                        continue;
                    }
                    if let Some(session) = parse_codex_jsonl(&path) {
                        sessions.push(session);
                    }
                }
            }
        }
    }

    sessions
}

/// One line of a Codex rollout JSONL file. Mirrors the canonical parser in
/// `sources/codex/app.rs`: a top-level `type`/`timestamp` plus a nested
/// `payload` object whose shape depends on the line type.
#[derive(Debug, Deserialize)]
struct CodexScanLine {
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default, rename = "type")]
    line_type: String,
    #[serde(default)]
    payload: Value,
}

fn parse_codex_jsonl(path: &std::path::Path) -> Option<CliSession> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let file_name = path.file_stem()?.to_string_lossy().to_string();
    let mtime = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut first_timestamp: i64 = 0;
    let mut last_timestamp: i64 = 0;
    let mut message_count: i32 = 0;
    let mut model = String::new();
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut first_prompt = String::new();
    let mut workspace_path = String::new();

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: CodexScanLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        // Codex timestamps are ISO-8601 strings: "2026-02-11T06:16:06.458Z"
        if let Some(ts_ms) = parsed
            .timestamp
            .as_deref()
            .and_then(parse_iso_to_epoch_ms_opt)
        {
            if first_timestamp == 0 || ts_ms < first_timestamp {
                first_timestamp = ts_ms;
            }
            if ts_ms > last_timestamp {
                last_timestamp = ts_ms;
            }
        }

        // Workspace path: cwd lives on session_meta / turn_context payloads.
        if workspace_path.is_empty() {
            if let Some(cwd) = json_str(&parsed.payload, "cwd") {
                if !cwd.is_empty() {
                    workspace_path = cwd.to_string();
                }
            }
        }

        // Model name (e.g. "gpt-5.3-codex") lives on the turn_context payload.
        if model.is_empty() {
            if let Some(found_model) = json_str(&parsed.payload, "model") {
                if !found_model.is_empty() {
                    model = found_model.to_string();
                }
            }
        }

        // First user prompt: the earliest payload that carries a message string.
        if first_prompt.is_empty() {
            if let Some(msg) = json_str(&parsed.payload, "message") {
                if !msg.is_empty() {
                    first_prompt = truncate_str(msg, 200);
                }
            }
        }

        // Count response_item lines (assistant/tool turns).
        if parsed.line_type == "response_item" {
            message_count += 1;
        }

        // token_count events carry a cumulative total_token_usage — last wins.
        if parsed.payload.get("type").and_then(Value::as_str) == Some("token_count") {
            if let Some(total_usage) = parsed.payload.get("total_token_usage") {
                // Overwrite, not accumulate: the counter is cumulative. Preserve
                // the prior value if a field is absent on this record.
                total_input = json_i64(total_usage, "input_tokens").unwrap_or(total_input);
                total_output = json_i64(total_usage, "output_tokens").unwrap_or(total_output);
            }
        }
    }

    if first_timestamp == 0 && mtime == 0 {
        return None;
    }

    let created_at = if first_timestamp > 0 {
        first_timestamp
    } else {
        mtime
    };
    let last_active_at = if last_timestamp > 0 {
        last_timestamp
    } else {
        mtime
    };

    Some(CliSession {
        id: format!("codex:{}", file_name),
        tool: CliTool::Codex,
        name: if first_prompt.is_empty() {
            file_name
        } else {
            first_prompt
        },
        created_at,
        last_active_at,
        message_count,
        model,
        workspace_path,
        input_tokens: total_input,
        output_tokens: total_output,
        estimated_cost: 0.0,
        recorded_cost: 0.0,
    })
}

// ============================================
// Gemini CLI Scanner (~/.gemini/tmp/*/chats/*)
// ============================================

fn scan_gemini_sessions(gemini_dir: &Path) -> Vec<CliSession> {
    let tmp_dir = gemini_dir.join("tmp");
    if !tmp_dir.is_dir() {
        return Vec::new();
    }

    let mut sessions = Vec::new();

    // Walk workspace hash directories
    for project_entry in fs::read_dir(&tmp_dir).into_iter().flatten().flatten() {
        if !project_entry.path().is_dir() {
            continue;
        }
        let chats_dir = project_entry.path().join("chats");
        if !chats_dir.is_dir() {
            continue;
        }

        for chat_entry in fs::read_dir(&chats_dir).into_iter().flatten().flatten() {
            let path = chat_entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(session) = parse_gemini_session(&path) {
                sessions.push(session);
            }
        }
    }

    sessions
}

fn parse_gemini_session(path: &std::path::Path) -> Option<CliSession> {
    let content = fs::read_to_string(path).ok()?;
    let file_name = path.file_stem()?.to_string_lossy().to_string();

    let mtime = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Gemini stores chat sessions as JSON (single object) or JSONL.
    let mut message_count: i32 = 0;
    let mut model_counts: HashMap<String, usize> = HashMap::new();
    let mut first_prompt = String::new();
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;

    for document in parse_json_documents(&content) {
        for_each_json_node(&document, &mut |node| {
            if !node.is_object() {
                return;
            }

            // Message nodes carry a role ("user" / "model" / "assistant").
            if let Some(role) = json_str(node, "role") {
                if matches!(role, "user" | "model" | "assistant") {
                    message_count += 1;
                }
                if first_prompt.is_empty() && role == "user" {
                    if let Some(text) = json_message_text(node) {
                        first_prompt = truncate_str(&text, 200);
                    }
                }
            }

            if let Some(model) = json_str(node, "model") {
                if model.contains("gemini") {
                    *model_counts.entry(model.to_string()).or_insert(0) += 1;
                }
            }

            // Usage counters can appear under either the OpenAI-style or the
            // Gemini-style field names; sum whichever are present on the node.
            for field in ["input_tokens", "promptTokenCount"] {
                if let Some(input) = json_i64(node, field) {
                    total_input += input;
                }
            }
            for field in ["output_tokens", "candidatesTokenCount"] {
                if let Some(output) = json_i64(node, field) {
                    total_output += output;
                }
            }
        });
    }

    if message_count == 0 && mtime == 0 {
        return None;
    }

    let primary_model = model_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(model, _)| model)
        .unwrap_or_default();

    Some(CliSession {
        id: format!("gemini:{}", file_name),
        tool: CliTool::Gemini,
        name: if first_prompt.is_empty() {
            file_name
        } else {
            first_prompt
        },
        created_at: mtime,
        last_active_at: mtime,
        message_count,
        model: primary_model,
        workspace_path: String::new(),
        input_tokens: total_input,
        output_tokens: total_output,
        estimated_cost: 0.0,
        recorded_cost: 0.0,
    })
}

// ============================================
// Kiro CLI Scanner (~/.kiro/sessions/)
// ============================================

fn scan_kiro_sessions(kiro_dir: &Path) -> Vec<CliSession> {
    // Kiro stores sessions as JSON files — check common locations
    let candidates = [kiro_dir.join("sessions"), kiro_dir.join("chats")];

    let mut sessions = Vec::new();

    for dir in &candidates {
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(session) = parse_kiro_session(&path) {
                    sessions.push(session);
                }
            } else if path.is_dir() {
                // Kiro may nest sessions in subdirectories
                for sub_entry in fs::read_dir(&path).into_iter().flatten().flatten() {
                    let sub_path = sub_entry.path();
                    if sub_path.is_file() {
                        if let Some(session) = parse_kiro_session(&sub_path) {
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    sessions
}

fn parse_kiro_session(path: &std::path::Path) -> Option<CliSession> {
    let ext = path.extension()?.to_string_lossy();
    if ext != "json" && ext != "jsonl" {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    let file_name = path.file_stem()?.to_string_lossy().to_string();

    let mtime = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut message_count: i32 = 0;
    let mut first_prompt = String::new();
    let mut model = String::new();
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;

    for document in parse_json_documents(&content) {
        for_each_json_node(&document, &mut |node| {
            if !node.is_object() {
                return;
            }

            if let Some(role) = json_str(node, "role") {
                if matches!(role, "user" | "assistant" | "model") {
                    message_count += 1;
                }
                if first_prompt.is_empty() && role == "user" {
                    if let Some(text) = json_message_text(node) {
                        first_prompt = truncate_str(&text, 200);
                    }
                }
            }

            if model.is_empty() {
                if let Some(found_model) = json_str(node, "model") {
                    if !found_model.is_empty() {
                        model = found_model.to_string();
                    }
                }
            }

            if let Some(input) = json_i64(node, "input_tokens") {
                total_input += input;
            }
            if let Some(output) = json_i64(node, "output_tokens") {
                total_output += output;
            }
        });
    }

    if message_count == 0 && mtime == 0 {
        return None;
    }

    Some(CliSession {
        id: format!("kiro:{}", file_name),
        tool: CliTool::Kiro,
        name: if first_prompt.is_empty() {
            file_name
        } else {
            first_prompt
        },
        created_at: mtime,
        last_active_at: mtime,
        message_count,
        model,
        workspace_path: String::new(),
        input_tokens: total_input,
        output_tokens: total_output,
        estimated_cost: 0.0,
        recorded_cost: 0.0,
    })
}

// ============================================
// Aider Scanner (~/.aider/)
// ============================================

fn scan_aider_sessions(aider_dir: &Path) -> Vec<CliSession> {
    // Aider stores chat history in markdown/JSONL files
    let history_dir = aider_dir.join("history");
    if !history_dir.is_dir() {
        // Also check for .aider.chat.history.md in common workspace dirs
        return Vec::new();
    }

    let mut sessions = Vec::new();

    for entry in fs::read_dir(&history_dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        if ext != "json" && ext != "jsonl" && ext != "md" {
            continue;
        }

        if let Some(session) = parse_aider_session(&path) {
            sessions.push(session);
        }
    }

    sessions
}

fn parse_aider_session(path: &std::path::Path) -> Option<CliSession> {
    let content = fs::read_to_string(path).ok()?;
    let file_name = path.file_stem()?.to_string_lossy().to_string();

    let mtime = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    if content.trim().is_empty() {
        return None;
    }

    let is_markdown = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md"))
        .unwrap_or(false);

    let mut message_count: i32;
    let mut first_prompt: String;
    let mut model = String::new();
    let mut input_tokens: i64 = 0;
    let mut output_tokens: i64 = 0;

    if is_markdown {
        // Aider's `.aider.chat.history.md` is Markdown, not JSON: each user turn
        // is prefixed with "#### ". Count those turns directly (real count,
        // replacing the former `lines / 4` estimate).
        message_count = content.lines().filter(|l| l.starts_with("#### ")).count() as i32;
        first_prompt = content
            .lines()
            .find(|l| l.starts_with("#### "))
            .map(|l| truncate_str(l.trim_start_matches("#### "), 200))
            .unwrap_or_else(|| file_name.clone());

        // Token accounting stays 0 for the Markdown history: usage is only ever
        // recorded there in human-formatted, abbreviated lines such as
        // `> Tokens: 12k sent, 3.4k received.` that mix per-message and
        // cumulative session figures. They are not reliably machine-parseable
        // without risking double-counting, so we do not derive token counts from
        // them. Structured (JSON/JSONL) Aider logs are handled below.
    } else {
        // JSON / JSONL Aider logs carry structured usage; parse them properly.
        message_count = 0;
        first_prompt = String::new();
        for document in parse_json_documents(&content) {
            for_each_json_node(&document, &mut |node| {
                if !node.is_object() {
                    return;
                }
                if let Some(role) = json_str(node, "role") {
                    if matches!(role, "user" | "assistant") {
                        message_count += 1;
                    }
                    if first_prompt.is_empty() && role == "user" {
                        if let Some(text) = json_message_text(node) {
                            first_prompt = truncate_str(&text, 200);
                        }
                    }
                }
                if model.is_empty() {
                    if let Some(found_model) = json_str(node, "model") {
                        if !found_model.is_empty() {
                            model = found_model.to_string();
                        }
                    }
                }
                if let Some(input) = json_i64(node, "input_tokens") {
                    input_tokens += input;
                }
                if let Some(output) = json_i64(node, "output_tokens") {
                    output_tokens += output;
                }
            });
        }
        if first_prompt.is_empty() {
            first_prompt = file_name.clone();
        }
    }

    Some(CliSession {
        id: format!("aider:{}", file_name),
        tool: CliTool::Aider,
        name: first_prompt,
        created_at: mtime,
        last_active_at: mtime,
        message_count,
        model,
        workspace_path: String::new(),
        input_tokens,
        output_tokens,
        estimated_cost: 0.0,
        recorded_cost: 0.0,
    })
}

// ============================================
// Cursor CLI Scanner (~/.cursor/)
// ============================================

fn scan_cursor_cli_sessions(cursor_dir: &Path) -> Vec<CliSession> {
    // Cursor CLI stores agent sessions — check for CLI-specific session dirs
    let candidates = [
        cursor_dir.join("cli-sessions"),
        cursor_dir.join("agent-sessions"),
    ];

    let mut sessions = Vec::new();

    for dir in &candidates {
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(session) = parse_cursor_cli_session(&path) {
                sessions.push(session);
            }
        }
    }

    sessions
}

fn parse_cursor_cli_session(path: &std::path::Path) -> Option<CliSession> {
    let ext = path.extension()?.to_string_lossy();
    if ext != "json" && ext != "jsonl" {
        return None;
    }

    let content = fs::read_to_string(path).ok()?;
    let file_name = path.file_stem()?.to_string_lossy().to_string();

    let mtime = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut message_count: i32 = 0;
    let mut first_prompt = String::new();
    let mut model = String::new();
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;

    for document in parse_json_documents(&content) {
        for_each_json_node(&document, &mut |node| {
            if !node.is_object() {
                return;
            }

            if let Some(role) = json_str(node, "role") {
                if matches!(role, "user" | "assistant") {
                    message_count += 1;
                }
                if first_prompt.is_empty() && role == "user" {
                    if let Some(text) = json_message_text(node) {
                        first_prompt = truncate_str(&text, 200);
                    }
                }
            }

            if model.is_empty() {
                if let Some(found_model) = json_str(node, "model") {
                    if !found_model.is_empty() {
                        model = found_model.to_string();
                    }
                }
            }

            if let Some(input) = json_i64(node, "input_tokens") {
                total_input += input;
            }
            if let Some(output) = json_i64(node, "output_tokens") {
                total_output += output;
            }
        });
    }

    if message_count == 0 && mtime == 0 {
        return None;
    }

    Some(CliSession {
        id: format!("cursor_cli:{}", file_name),
        tool: CliTool::CursorCli,
        name: if first_prompt.is_empty() {
            file_name
        } else {
            first_prompt
        },
        created_at: mtime,
        last_active_at: mtime,
        message_count,
        model,
        workspace_path: String::new(),
        input_tokens: total_input,
        output_tokens: total_output,
        estimated_cost: 0.0,
        recorded_cost: 0.0,
    })
}

// ============================================
// Cache Operations
// ============================================

/// Clear all cached entries when parser version changes.
/// Uses a simple `cli_cache_meta` table to track the version.
fn invalidate_stale_cache(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cli_cache_meta (
            key   TEXT PRIMARY KEY,
            value INTEGER NOT NULL DEFAULT 0
        )",
    )
    .map_err(|err| format!("Failed to create cli_cache_meta: {}", err))?;

    let stored_version: i32 = conn
        .query_row(
            "SELECT value FROM cli_cache_meta WHERE key = 'parser_version'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if stored_version < PARSER_VERSION {
        conn.execute("DELETE FROM cli_session_cache", [])
            .map_err(|err| format!("Failed to clear stale cli cache: {}", err))?;
        conn.execute(
            "INSERT OR REPLACE INTO cli_cache_meta (key, value) VALUES ('parser_version', ?1)",
            params![PARSER_VERSION],
        )
        .map_err(|err| format!("Failed to update parser version: {}", err))?;
    }

    Ok(())
}

fn get_cached_mtimes(conn: &Connection) -> Result<HashMap<String, i64>, String> {
    let mut stmt = conn
        .prepare("SELECT id, last_active_at FROM cli_session_cache")
        .map_err(|err| format!("Failed to query cli cache: {}", err))?;

    let map = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|err| format!("Failed to read cli cache: {}", err))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(map)
}

fn upsert_cache(conn: &Connection, sessions: &[CliSession]) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO cli_session_cache
                (id, tool, name, created_at, last_active_at, message_count, model,
                 workspace_path, input_tokens, output_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                last_active_at = excluded.last_active_at,
                message_count = excluded.message_count,
                model = excluded.model,
                workspace_path = excluded.workspace_path,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens",
        )
        .map_err(|err| format!("Failed to prepare cli upsert: {}", err))?;

    for session in sessions {
        stmt.execute(params![
            session.id,
            session.tool.as_str(),
            session.name,
            session.created_at,
            session.last_active_at,
            session.message_count,
            session.model,
            session.workspace_path,
            session.input_tokens,
            session.output_tokens,
        ])
        .map_err(|err| format!("Failed to upsert cli session {}: {}", session.id, err))?;
    }

    Ok(())
}

fn query_cache(
    conn: &Connection,
    tool_filter: Option<&str>,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<CliSession>, String> {
    let start_epoch = date_str_to_epoch_ms(start_date);
    let end_epoch = date_str_to_epoch_ms_end(end_date);

    let (sql, tool_param) = match tool_filter {
        Some(tool) => (
            "SELECT id, tool, name, created_at, last_active_at, message_count,
                    model, workspace_path, input_tokens, output_tokens
             FROM cli_session_cache
             WHERE created_at >= ?1 AND created_at <= ?2 AND tool = ?3
             ORDER BY created_at DESC",
            Some(tool.to_string()),
        ),
        None => (
            "SELECT id, tool, name, created_at, last_active_at, message_count,
                    model, workspace_path, input_tokens, output_tokens
             FROM cli_session_cache
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at DESC",
            None,
        ),
    };

    let sessions = if let Some(ref tool) = tool_param {
        let mut stmt = conn
            .prepare(sql)
            .map_err(|err| format!("Failed to query cli cache: {}", err))?;
        let rows: Vec<CliSession> = stmt
            .query_map(params![start_epoch, end_epoch, tool], row_to_session)
            .map_err(|err| format!("Failed to read cli cache: {}", err))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        let mut stmt = conn
            .prepare(sql)
            .map_err(|err| format!("Failed to query cli cache: {}", err))?;
        let rows: Vec<CliSession> = stmt
            .query_map(params![start_epoch, end_epoch], row_to_session)
            .map_err(|err| format!("Failed to read cli cache: {}", err))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    Ok(sessions)
}

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<CliSession> {
    let tool_str: String = row.get(1)?;
    let tool = CliTool::from_str_value(&tool_str).unwrap_or(CliTool::Codex);
    Ok(CliSession {
        id: row.get(0)?,
        tool,
        name: row.get(2)?,
        created_at: row.get(3)?,
        last_active_at: row.get(4)?,
        message_count: row.get(5)?,
        model: row.get(6)?,
        workspace_path: row.get(7)?,
        input_tokens: row.get(8)?,
        output_tokens: row.get(9)?,
        estimated_cost: 0.0,
        recorded_cost: 0.0,
    })
}

// ============================================
// JSON Parsing Helpers (serde_json)
// ============================================

/// Parse a session file into one or more JSON documents.
///
/// Chat exports come in two shapes: a single JSON object/array spanning the
/// whole file, or JSONL (one object per line). Try the whole file first, then
/// fall back to per-line parsing so both are handled robustly.
fn parse_json_documents(content: &str) -> Vec<Value> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return vec![value];
    }
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                None
            } else {
                serde_json::from_str::<Value>(line).ok()
            }
        })
        .collect()
}

/// Visit a JSON value and every descendant, in document order (pre-order).
fn for_each_json_node(value: &Value, visit: &mut impl FnMut(&Value)) {
    visit(value);
    match value {
        Value::Array(items) => {
            for item in items {
                for_each_json_node(item, visit);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                for_each_json_node(item, visit);
            }
        }
        _ => {}
    }
}

/// Read a direct string field from an object node.
fn json_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Read a direct integer field from an object node, tolerating numbers encoded
/// as floats or numeric strings.
fn json_i64(value: &Value, key: &str) -> Option<i64> {
    let field = value.get(key)?;
    field
        .as_i64()
        .or_else(|| field.as_f64().map(|number| number as i64))
        .or_else(|| field.as_str().and_then(|text| text.trim().parse::<i64>().ok()))
}

/// Extract display text from a message node: a direct `text`/`content` string,
/// or the concatenated `text` parts of a `parts`/`content` array.
fn json_message_text(node: &Value) -> Option<String> {
    if let Some(text) = json_str(node, "text") {
        return Some(text.to_string());
    }
    if let Some(text) = json_str(node, "content") {
        return Some(text.to_string());
    }
    let parts = node
        .get("parts")
        .and_then(Value::as_array)
        .or_else(|| node.get("content").and_then(Value::as_array))?;
    let joined = parts
        .iter()
        .filter_map(|part| json_str(part, "text").map(str::to_string))
        .collect::<Vec<_>>();
    if joined.is_empty() {
        None
    } else {
        Some(joined.join("\n"))
    }
}

fn truncate_str(value: &str, max_len: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= max_len {
        trimmed.to_string()
    } else {
        let mut result: String = trimmed.chars().take(max_len - 1).collect();
        result.push('…');
        result
    }
}

/// Parse ISO-8601 timestamp (e.g. "2026-02-11T06:16:06.458Z") to epoch ms.
fn parse_iso_to_epoch_ms_opt(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| dt.timestamp_millis())
        .or_else(|| {
            // Try without fractional seconds / timezone variants
            chrono::NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S")
                .ok()
                .map(|dt| dt.and_utc().timestamp_millis())
        })
}

// ============================================
// Date Helpers (same as claude_code_db)
// ============================================

fn date_str_to_epoch_ms(date_str: &str) -> i64 {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return 0;
    }
    let year: i32 = parts[0].parse().unwrap_or(2025);
    let month: u32 = parts[1].parse().unwrap_or(1);
    let day: u32 = parts[2].parse().unwrap_or(1);

    match chrono::NaiveDate::from_ymd_opt(year, month, day) {
        Some(date) => {
            let dt = date.and_hms_opt(0, 0, 0).unwrap_or_default();
            let local = chrono::Local
                .from_local_datetime(&dt)
                .single()
                .unwrap_or_else(chrono::Local::now);
            local.timestamp_millis()
        }
        None => 0,
    }
}

fn date_str_to_epoch_ms_end(date_str: &str) -> i64 {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return i64::MAX;
    }
    let year: i32 = parts[0].parse().unwrap_or(2025);
    let month: u32 = parts[1].parse().unwrap_or(1);
    let day: u32 = parts[2].parse().unwrap_or(1);

    match chrono::NaiveDate::from_ymd_opt(year, month, day) {
        Some(date) => {
            let dt = date.and_hms_opt(23, 59, 59).unwrap_or_default();
            let local = chrono::Local
                .from_local_datetime(&dt)
                .single()
                .unwrap_or_else(chrono::Local::now);
            local.timestamp_millis()
        }
        None => i64::MAX,
    }
}
