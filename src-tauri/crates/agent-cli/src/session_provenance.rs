//! Managed hook installation for session provenance.
//!
//! ORG2 owns only hook entries whose command includes [`HOOK_MARKER`]. User
//! hooks and unrelated configuration are preserved semantically when the JSON
//! is rewritten.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const HOOK_MARKER: &str = "--session-provenance-hook";
const PREFERENCES_SCHEMA_VERSION: u32 = 1;
// Codex hook matchers use the public canonical tool names, not the internal
// transcript/runtime names (`exec`, `exec_command`, etc.). Keep this aligned
// with the official Hook matcher contract so Bash and apply_patch both fire.
const CODEX_POST_TOOL_USE_MATCHER: &str = "Bash|apply_patch|Edit|Write|mcp__.*";
static HOOK_CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionProvenanceHookPlatform {
    ClaudeCode,
    Codex,
    Cursor,
}

impl SessionProvenanceHookPlatform {
    fn source_arg(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude",
            Self::Codex => "codex",
            Self::Cursor => "cursor",
        }
    }

    fn config_path(self) -> PathBuf {
        match self {
            Self::ClaudeCode => app_paths::home_dir().join(".claude").join("settings.json"),
            Self::Codex => app_paths::home_dir().join(".codex").join("hooks.json"),
            Self::Cursor => app_paths::home_dir().join(".cursor").join("hooks.json"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct HookPreferences {
    schema_version: u32,
    claude_code: bool,
    codex: bool,
    cursor: bool,
}

impl Default for HookPreferences {
    fn default() -> Self {
        Self {
            schema_version: PREFERENCES_SCHEMA_VERSION,
            claude_code: true,
            codex: true,
            cursor: true,
        }
    }
}

impl HookPreferences {
    fn enabled(&self, platform: SessionProvenanceHookPlatform) -> bool {
        match platform {
            SessionProvenanceHookPlatform::ClaudeCode => self.claude_code,
            SessionProvenanceHookPlatform::Codex => self.codex,
            SessionProvenanceHookPlatform::Cursor => self.cursor,
        }
    }

    fn set_enabled(&mut self, platform: SessionProvenanceHookPlatform, enabled: bool) {
        match platform {
            SessionProvenanceHookPlatform::ClaudeCode => self.claude_code = enabled,
            SessionProvenanceHookPlatform::Codex => self.codex = enabled,
            SessionProvenanceHookPlatform::Cursor => self.cursor = enabled,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProvenanceHookStatus {
    pub platform: SessionProvenanceHookPlatform,
    pub enabled: bool,
    pub desired_enabled: bool,
    pub config_path: String,
}

fn preferences_path() -> PathBuf {
    app_paths::orgii_root()
        .join("session-provenance")
        .join("hooks.json")
}

fn operation_guard() -> Result<MutexGuard<'static, ()>, String> {
    HOOK_CONFIG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Session-provenance hook config lock is poisoned".to_string())
}

fn read_preferences() -> Result<HookPreferences, String> {
    let path = preferences_path();
    if !path.exists() {
        return Ok(HookPreferences::default());
    }
    let bytes =
        std::fs::read(&path).map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|err| format!("Invalid session-provenance preferences: {err}"))
}

fn write_preferences(preferences: &HookPreferences) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(preferences)
        .map_err(|err| format!("Failed to serialize hook preferences: {err}"))?;
    write_atomic(&preferences_path(), &bytes)
}

fn read_config(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let bytes =
        std::fs::read(path).map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    serde_json::from_slice(&bytes)
        .map_err(|err| format!("Invalid JSON in {}: {err}", path.display()))
}

fn write_config(path: &Path, config: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|err| format!("Failed to serialize {}: {err}", path.display()))?;
    write_atomic(path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("hooks.json");
    let temp = path.with_file_name(format!(".{name}.{}.{nanos}.tmp", std::process::id()));
    std::fs::write(&temp, bytes)
        .map_err(|err| format!("Failed to write {}: {err}", temp.display()))?;
    app_paths::set_sensitive_file_permissions(&temp).ok();
    std::fs::rename(&temp, path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        format!("Failed to publish {}: {err}", path.display())
    })
}

fn hook_commands(executable: &Path, source: &str) -> (String, String) {
    let raw = executable.to_string_lossy();
    let unix_path = format!("'{}'", raw.replace('\'', "'\\''"));
    let windows_path = format!("\"{}\"", raw.replace('"', "\\\""));
    (
        format!("{unix_path} {HOOK_MARKER} {source}"),
        format!("{windows_path} {HOOK_MARKER} {source}"),
    )
}

fn command_contains_marker(value: &Value) -> bool {
    value
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.contains(HOOK_MARKER))
        || value
            .get("commandWindows")
            .and_then(Value::as_str)
            .is_some_and(|command| command.contains(HOOK_MARKER))
}

fn hooks_object_mut(config: &mut Value) -> Result<&mut Map<String, Value>, String> {
    let root = config
        .as_object_mut()
        .ok_or_else(|| "Hook config root must be a JSON object".to_string())?;
    if !root.contains_key("hooks") {
        root.insert("hooks".to_string(), Value::Object(Map::new()));
    }
    root.get_mut("hooks")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Hook config `hooks` must be a JSON object".to_string())
}

fn update_nested_platform(
    config: &mut Value,
    enabled: bool,
    matcher: &str,
    unix_command: &str,
    windows_command: &str,
) -> Result<(), String> {
    let hooks = hooks_object_mut(config)?;
    if !hooks.contains_key("PostToolUse") {
        hooks.insert("PostToolUse".to_string(), Value::Array(Vec::new()));
    }
    let groups = hooks
        .get_mut("PostToolUse")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Hook config `hooks.PostToolUse` must be an array".to_string())?;
    for group in groups.iter_mut() {
        if let Some(commands) = group.get_mut("hooks").and_then(Value::as_array_mut) {
            commands.retain(|command| !command_contains_marker(command));
        }
    }
    groups.retain(|group| {
        group
            .get("hooks")
            .and_then(Value::as_array)
            .is_none_or(|commands| !commands.is_empty())
    });
    if enabled {
        groups.push(json!({
            "matcher": matcher,
            "hooks": [{
                "type": "command",
                "command": unix_command,
                "commandWindows": windows_command,
                "timeout": 5
            }]
        }));
    }
    Ok(())
}

fn update_cursor_platform(
    config: &mut Value,
    enabled: bool,
    unix_command: &str,
) -> Result<(), String> {
    config
        .as_object_mut()
        .ok_or_else(|| "Cursor hook config root must be a JSON object".to_string())?
        .entry("version")
        .or_insert(json!(1));
    let hooks = hooks_object_mut(config)?;
    for event_name in ["postToolUse", "subagentStop"] {
        if !hooks.contains_key(event_name) {
            hooks.insert(event_name.to_string(), Value::Array(Vec::new()));
        }
        let commands = hooks
            .get_mut(event_name)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| format!("Cursor hook config `hooks.{event_name}` must be an array"))?;
        commands.retain(|command| !command_contains_marker(command));
        if enabled {
            let mut hook = json!({ "command": unix_command });
            if event_name == "postToolUse" {
                hook.as_object_mut()
                    .expect("hook is object")
                    .insert("matcher".to_string(), json!(".*"));
            }
            commands.push(hook);
        }
    }
    Ok(())
}

fn update_platform(
    platform: SessionProvenanceHookPlatform,
    enabled: bool,
    executable: &Path,
) -> Result<(), String> {
    let path = platform.config_path();
    if !enabled && !path.exists() {
        return Ok(());
    }
    let mut config = read_config(&path)?;
    let (unix_command, windows_command) = hook_commands(executable, platform.source_arg());
    match platform {
        SessionProvenanceHookPlatform::ClaudeCode | SessionProvenanceHookPlatform::Codex => {
            let matcher = match platform {
                SessionProvenanceHookPlatform::ClaudeCode => {
                    "Read|Write|Edit|MultiEdit|NotebookEdit|Delete|Glob|Grep"
                }
                SessionProvenanceHookPlatform::Codex => CODEX_POST_TOOL_USE_MATCHER,
                SessionProvenanceHookPlatform::Cursor => unreachable!(),
            };
            update_nested_platform(
                &mut config,
                enabled,
                matcher,
                &unix_command,
                &windows_command,
            )?
        }
        SessionProvenanceHookPlatform::Cursor => {
            let cursor_command = if cfg!(windows) {
                &windows_command
            } else {
                &unix_command
            };
            update_cursor_platform(&mut config, enabled, cursor_command)?
        }
    }
    write_config(&path, &config)
}

fn config_has_managed_hook(platform: SessionProvenanceHookPlatform) -> Result<bool, String> {
    let config = read_config(&platform.config_path())?;
    Ok(config.to_string().contains(HOOK_MARKER))
}

/// Reconcile hook files with ORG2 preferences. On first launch preferences
/// default to all supported platforms enabled.
pub fn ensure_hooks_from_preferences() -> Result<(), String> {
    let _guard = operation_guard()?;
    let preferences = read_preferences()?;
    let executable = std::env::current_exe()
        .map_err(|err| format!("Failed to locate ORG2 executable: {err}"))?;
    let mut errors = Vec::new();
    for platform in [
        SessionProvenanceHookPlatform::ClaudeCode,
        SessionProvenanceHookPlatform::Codex,
        SessionProvenanceHookPlatform::Cursor,
    ] {
        if let Err(err) = update_platform(platform, preferences.enabled(platform), &executable) {
            errors.push(format!("{platform:?}: {err}"));
        }
    }
    write_preferences(&preferences)?;
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
pub async fn session_provenance_hooks_status() -> Result<Vec<SessionProvenanceHookStatus>, String> {
    tokio::task::spawn_blocking(|| {
        let _guard = operation_guard()?;
        let preferences = read_preferences()?;
        [
            SessionProvenanceHookPlatform::ClaudeCode,
            SessionProvenanceHookPlatform::Codex,
            SessionProvenanceHookPlatform::Cursor,
        ]
        .into_iter()
        .map(|platform| {
            Ok(SessionProvenanceHookStatus {
                platform,
                enabled: config_has_managed_hook(platform).unwrap_or(false),
                desired_enabled: preferences.enabled(platform),
                config_path: platform.config_path().to_string_lossy().into_owned(),
            })
        })
        .collect()
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn session_provenance_hooks_set_enabled(
    platform: SessionProvenanceHookPlatform,
    enabled: bool,
) -> Result<SessionProvenanceHookStatus, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = operation_guard()?;
        let executable = std::env::current_exe()
            .map_err(|err| format!("Failed to locate ORG2 executable: {err}"))?;
        let mut preferences = read_preferences()?;
        update_platform(platform, enabled, &executable)?;
        preferences.set_enabled(platform, enabled);
        write_preferences(&preferences)?;
        Ok(SessionProvenanceHookStatus {
            platform,
            enabled: config_has_managed_hook(platform)?,
            desired_enabled: enabled,
            config_path: platform.config_path().to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_config_preserves_user_hooks_and_removes_only_ours() {
        let mut config = json!({
            "hooks": {"PostToolUse": [{
                "matcher": "Read",
                "hooks": [{"type": "command", "command": "user-hook"}]
            }]},
            "theme": "dark"
        });
        update_nested_platform(
            &mut config,
            true,
            "Read",
            "orgii --session-provenance-hook claude",
            "orgii.exe --session-provenance-hook claude",
        )
        .expect("enable nested hook");
        update_nested_platform(&mut config, false, "Read", "unused", "unused")
            .expect("disable nested hook");
        assert_eq!(config["theme"], "dark");
        assert_eq!(
            config["hooks"]["PostToolUse"][0]["hooks"][0]["command"],
            "user-hook"
        );
        assert!(!config.to_string().contains(HOOK_MARKER));
    }

    #[test]
    fn codex_matcher_uses_public_hook_tool_names() {
        assert!(CODEX_POST_TOOL_USE_MATCHER.contains("Bash"));
        assert!(CODEX_POST_TOOL_USE_MATCHER.contains("apply_patch"));
        assert!(!CODEX_POST_TOOL_USE_MATCHER.contains("exec_command"));
    }

    #[test]
    fn cursor_config_preserves_user_events() {
        let mut config = json!({
            "version": 1,
            "hooks": {"postToolUse": [{"command": "user-hook"}]}
        });
        update_cursor_platform(&mut config, true, "orgii --session-provenance-hook cursor")
            .expect("enable Cursor hook");
        assert_eq!(config["hooks"]["postToolUse"].as_array().unwrap().len(), 2);
        assert_eq!(config["hooks"]["subagentStop"].as_array().unwrap().len(), 1);
        update_cursor_platform(&mut config, false, "unused").expect("disable Cursor hook");
        assert_eq!(config["hooks"]["postToolUse"].as_array().unwrap().len(), 1);
        assert!(config["hooks"]["subagentStop"]
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn unknown_hook_shapes_fail_without_clobbering_config() {
        let mut config = json!({"hooks": "future-format", "theme": "dark"});
        let original = config.clone();
        let error = update_nested_platform(&mut config, true, "Read", "orgii", "orgii.exe")
            .expect_err("unknown shape must fail closed");
        assert!(error.contains("must be a JSON object"));
        assert_eq!(config, original);
    }
}
