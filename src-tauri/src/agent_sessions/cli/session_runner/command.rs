//! CLI command building and parser creation for each CLI agent type (ModelType).

use crate::agent_sessions::cli::parsers::claude_code::ClaudeCodeParser;
use crate::agent_sessions::cli::parsers::codex::CodexParser;
use crate::agent_sessions::cli::parsers::cursor::CursorParser;
use crate::agent_sessions::cli::parsers::gemini::GeminiParser;
use crate::agent_sessions::cli::parsers::CliAgentParser;
use crate::agent_sessions::cli::session_runner::launch_profiles::{
    defaults_for_agent, static_args_to_vec, ResolvedCliLaunchProfile,
};
use key_vault::key_store::ModelType;
use std::collections::HashMap;

pub(super) struct CliCommandBuildRequest<'a> {
    pub agent: &'a ModelType,
    pub launch_profile: &'a ResolvedCliLaunchProfile,
    pub model: Option<&'a str>,
    pub task: &'a str,
    pub resume_id: Option<&'a str>,
    pub api_key: Option<&'a str>,
    pub endpoint: Option<&'a str>,
    pub mode: Option<&'a str>,
    pub repo_path: Option<&'a str>,
    pub additional_dirs: &'a [String],
}

pub(super) fn build_command_with_launch_profile(
    request: CliCommandBuildRequest<'_>,
) -> Vec<String> {
    let CliCommandBuildRequest {
        agent,
        launch_profile,
        model,
        task,
        resume_id,
        api_key,
        endpoint,
        mode,
        repo_path,
        additional_dirs,
    } = request;

    if !additional_dirs.is_empty() && !matches!(agent, ModelType::ClaudeCode | ModelType::Codex) {
        tracing::warn!(
            agent = ?agent,
            dirs = ?additional_dirs,
            "[cli-runner] CLI agent does not support --add-dir; additional directories will NOT be visible to it",
        );
    }

    let mut cmd = vec![launch_profile.command.clone()];
    if let Some(defaults) = defaults_for_agent(agent) {
        cmd.extend(static_args_to_vec(defaults.command_args));
    }
    cmd.extend(launch_profile.args.clone());

    match agent {
        ModelType::CursorCli => {
            cmd.push("--output-format".into());
            cmd.push("stream-json".into());
            cmd.push("--stream-partial-output".into());
            if let Some(key) = api_key {
                cmd.push("--api-key".into());
                cmd.push(key.into());
            }
            if let Some(ep) = endpoint {
                cmd.push("--endpoint".into());
                cmd.push(ep.into());
                cmd.push("--agent-endpoint".into());
                cmd.push(ep.into());
            }
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(m.into());
            }
            if let Some(md) = mode {
                if matches!(md, "plan" | "ask") {
                    cmd.push("--mode".into());
                    cmd.push(md.into());
                }
            }
            if let Some(ws) = repo_path {
                cmd.push("--workspace".into());
                cmd.push(ws.into());
            }
            cmd.push("-p".into());
            cmd.push(task.into());
            cmd
        }
        ModelType::ClaudeCode => {
            cmd.push("--output-format".into());
            cmd.push("stream-json".into());
            cmd.push("--verbose".into());
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(map_claude_model(m));
            }
            for dir in additional_dirs {
                if dir.is_empty() {
                    continue;
                }
                cmd.push("--add-dir".into());
                cmd.push(dir.clone());
            }
            cmd.push("-p".into());
            cmd.push(task.into());
            cmd
        }
        ModelType::Codex => {
            cmd.push("--json".into());
            cmd.push("--skip-git-repo-check".into());
            if let Some(ws) = repo_path {
                cmd.push("--cd".into());
                cmd.push(ws.into());
            }
            if let Some(m) = model {
                cmd.push("-m".into());
                cmd.push(m.into());
            }
            if let Some(rid) = resume_id {
                cmd.push("resume".into());
                cmd.push(rid.into());
            }
            for dir in additional_dirs {
                if dir.is_empty() {
                    continue;
                }
                cmd.push("--add-dir".into());
                cmd.push(dir.clone());
            }
            cmd.push(task.into());
            cmd
        }
        ModelType::GeminiCli => {
            cmd.push("--output-format".into());
            cmd.push("stream-json".into());
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(m.into());
            }
            cmd.push("-p".into());
            cmd.push(task.into());
            cmd
        }
        ModelType::Copilot => {
            cmd.push("--acp".into());
            if let Some(rid) = resume_id {
                cmd.push("--resume".into());
                cmd.push(rid.into());
            }
            if let Some(m) = model {
                cmd.push("--model".into());
                cmd.push(m.into());
            }
            cmd
        }
        ModelType::Kiro | ModelType::OpenCode => cmd,
        ModelType::KimiCli
        | ModelType::Aider
        | ModelType::Goose
        | ModelType::Amp
        | ModelType::Cline
        | ModelType::Kilo
        | ModelType::Grok
        | ModelType::Devin
        | ModelType::Rovo
        | ModelType::Hermes
        | ModelType::OpenClaw
        | ModelType::Aug
        | ModelType::Codebuff
        | ModelType::QwenCode
        | ModelType::MimoCode
        | ModelType::Antigravity
        | ModelType::Continue
        | ModelType::Droid
        | ModelType::MistralVibe
        | ModelType::Autohand
        | ModelType::Omp
        | ModelType::Pi => {
            if !task.is_empty() {
                cmd.push(task.into());
            }
            cmd
        }
        other => {
            panic!(
                "ModelType::{:?} is not a CLI agent — cannot build command",
                other
            );
        }
    }
}

pub(super) fn launch_profile_env(profile: &ResolvedCliLaunchProfile) -> HashMap<String, String> {
    profile.env.clone()
}

/// Map market shorthand model names to full CLI model names.
///
/// Fallback mapping for when the proxy's resolved `model_name` is unavailable
/// (e.g., fallback allocation path, pool sync failure, or local billing mode).
/// The hosted service normalizes "claude-sonnet-4.5" → "sonnet-4.5", but the
/// Claude Code CLI expects full names like "claude-sonnet-4.5".
/// This re-adds the "claude-" prefix for Claude-family models.
/// Non-Claude models (gpt-*, gemini-*, grok-*, raptor-*) pass through unchanged.
///
/// Also strips trailing YYYYMMDD date suffixes (e.g. `claude-haiku-4-5-20251001`
/// → `claude-haiku-4-5`). The API layer accepts these suffixes, but Claude Code
/// CLI rejects them.
pub(super) fn map_claude_model(model: &str) -> String {
    let model = strip_cli_date_suffix(model);
    agent_core::providers::model_hints::normalize_claude_shorthand(model)
}

/// Strip a trailing 8-digit date suffix (YYYYMMDD) from a model ID.
/// E.g. `claude-haiku-4-5-20251001` → `claude-haiku-4-5`.
/// Non-matching strings are returned unchanged.
fn strip_cli_date_suffix(model: &str) -> &str {
    if let Some(pos) = model.rfind('-') {
        let suffix = &model[pos + 1..];
        if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
            return &model[..pos];
        }
    }
    model
}

/// Create the appropriate parser for a CLI agent type.
///
/// Copilot uses ACP (bidirectional JSON-RPC) instead of CliAgentParser.
/// API key providers are not CLI agents and should never reach this function.
pub(super) fn create_parser(agent: &ModelType, session_id: &str) -> Box<dyn CliAgentParser> {
    match agent {
        ModelType::CursorCli => Box::new(CursorParser::new(session_id)),
        ModelType::ClaudeCode => Box::new(ClaudeCodeParser::new(session_id)),
        ModelType::Codex => Box::new(CodexParser::new(session_id)),
        ModelType::GeminiCli => Box::new(GeminiParser::new(session_id)),
        other => panic!(
            "ModelType::{:?} does not use CliAgentParser (Copilot/Kiro use ACP; API providers are not CLI agents)",
            other
        ),
    }
}
