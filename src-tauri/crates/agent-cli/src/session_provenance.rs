//! Managed hook installation for session provenance.
//!
//! ORG2 owns only hook entries whose command includes [`HOOK_MARKER`]. User
//! hooks and unrelated configuration are preserved semantically when the JSON
//! is rewritten.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const HOOK_MARKER: &str = "--session-provenance-hook";
const PREFERENCES_SCHEMA_VERSION: u32 = 1;
const ALL_SESSION_PROVENANCE_HOOK_PLATFORMS: [SessionProvenanceHookPlatform; 3] = [
    SessionProvenanceHookPlatform::ClaudeCode,
    SessionProvenanceHookPlatform::Codex,
    SessionProvenanceHookPlatform::Cursor,
];
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
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
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
    pub error: Option<String>,
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
    let preferences: HookPreferences = serde_json::from_slice(&bytes)
        .map_err(|err| format!("Invalid session-provenance preferences: {err}"))?;
    if preferences.schema_version != PREFERENCES_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported session-provenance preferences schema version: {}",
            preferences.schema_version
        ));
    }
    Ok(preferences)
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
    let parent = path
        .parent()
        .ok_or_else(|| format!("Hook config has no parent directory: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    let mut temp = tempfile::Builder::new()
        .prefix(".orgii-session-provenance-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|err| format!("Failed to create temp file in {}: {err}", parent.display()))?;
    temp.write_all(bytes)
        .map_err(|err| format!("Failed to write hook config temp file: {err}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|err| format!("Failed to flush hook config temp file: {err}"))?;
    app_paths::set_sensitive_file_permissions(temp.path()).ok();
    temp.persist(path)
        .map(|_| ())
        .map_err(|err| format!("Failed to publish {}: {}", path.display(), err.error))
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

fn command_is_managed_for_platform(value: &Value, platform: SessionProvenanceHookPlatform) -> bool {
    let expected = format!("{HOOK_MARKER} {}", platform.source_arg());
    ["command", "commandWindows"].into_iter().any(|field| {
        value
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|command| command.trim_end().ends_with(&expected))
    })
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
    update_nested_event(
        config,
        "PostToolUse",
        enabled,
        Some(matcher),
        unix_command,
        windows_command,
    )
}

fn update_nested_event(
    config: &mut Value,
    event_name: &str,
    enabled: bool,
    matcher: Option<&str>,
    unix_command: &str,
    windows_command: &str,
) -> Result<(), String> {
    let hooks = hooks_object_mut(config)?;
    if !hooks.contains_key(event_name) {
        hooks.insert(event_name.to_string(), Value::Array(Vec::new()));
    }
    let groups = hooks
        .get_mut(event_name)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| format!("Hook config `hooks.{event_name}` must be an array"))?;
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
        let mut group = json!({
            "hooks": [{
                "type": "command",
                "command": unix_command,
                "commandWindows": windows_command,
                "timeout": 5
            }]
        });
        if let Some(matcher) = matcher {
            group
                .as_object_mut()
                .expect("hook group is object")
                .insert("matcher".to_string(), json!(matcher));
        }
        groups.push(group);
    }
    Ok(())
}

fn update_codex_platform(
    config: &mut Value,
    enabled: bool,
    unix_command: &str,
    windows_command: &str,
) -> Result<(), String> {
    update_nested_event(
        config,
        "PostToolUse",
        enabled,
        Some(CODEX_POST_TOOL_USE_MATCHER),
        unix_command,
        windows_command,
    )?;
    for event_name in ["SubagentStart", "SubagentStop"] {
        update_nested_event(
            config,
            event_name,
            enabled,
            None,
            unix_command,
            windows_command,
        )?;
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
    for event_name in ["postToolUse", "subagentStart", "subagentStop"] {
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
        SessionProvenanceHookPlatform::ClaudeCode => update_nested_platform(
            &mut config,
            enabled,
            "Read|Write|Edit|MultiEdit|NotebookEdit|Delete|Glob|Grep",
            &unix_command,
            &windows_command,
        )?,
        SessionProvenanceHookPlatform::Codex => {
            update_codex_platform(&mut config, enabled, &unix_command, &windows_command)?
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

fn nested_event_has_managed_hook(
    config: &Value,
    platform: SessionProvenanceHookPlatform,
    event_name: &str,
    matcher: Option<&str>,
) -> bool {
    config
        .get("hooks")
        .and_then(|hooks| hooks.get(event_name))
        .and_then(Value::as_array)
        .is_some_and(|groups| {
            groups.iter().any(|group| {
                let matcher_matches = match matcher {
                    Some(expected) => {
                        group.get("matcher").and_then(Value::as_str) == Some(expected)
                    }
                    None => group.get("matcher").is_none(),
                };
                matcher_matches
                    && group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .is_some_and(|commands| {
                            commands
                                .iter()
                                .any(|command| command_is_managed_for_platform(command, platform))
                        })
            })
        })
}

fn cursor_event_has_managed_hook(config: &Value, event_name: &str, matcher: Option<&str>) -> bool {
    config
        .get("hooks")
        .and_then(|hooks| hooks.get(event_name))
        .and_then(Value::as_array)
        .is_some_and(|commands| {
            commands.iter().any(|command| {
                let matcher_matches = match matcher {
                    Some(expected) => {
                        command.get("matcher").and_then(Value::as_str) == Some(expected)
                    }
                    None => command.get("matcher").is_none(),
                };
                matcher_matches
                    && command_is_managed_for_platform(
                        command,
                        SessionProvenanceHookPlatform::Cursor,
                    )
            })
        })
}

fn config_has_complete_managed_hooks(
    config: &Value,
    platform: SessionProvenanceHookPlatform,
) -> bool {
    match platform {
        SessionProvenanceHookPlatform::ClaudeCode => nested_event_has_managed_hook(
            config,
            platform,
            "PostToolUse",
            Some("Read|Write|Edit|MultiEdit|NotebookEdit|Delete|Glob|Grep"),
        ),
        SessionProvenanceHookPlatform::Codex => {
            nested_event_has_managed_hook(
                config,
                platform,
                "PostToolUse",
                Some(CODEX_POST_TOOL_USE_MATCHER),
            ) && nested_event_has_managed_hook(config, platform, "SubagentStart", None)
                && nested_event_has_managed_hook(config, platform, "SubagentStop", None)
        }
        SessionProvenanceHookPlatform::Cursor => {
            cursor_event_has_managed_hook(config, "postToolUse", Some(".*"))
                && cursor_event_has_managed_hook(config, "subagentStart", None)
                && cursor_event_has_managed_hook(config, "subagentStop", None)
        }
    }
}

fn config_has_managed_hooks(platform: SessionProvenanceHookPlatform) -> Result<bool, String> {
    let config = read_config(&platform.config_path())?;
    Ok(config_has_complete_managed_hooks(&config, platform))
}

/// Reconcile hook files with ORG2 preferences. On first launch preferences
/// default to all supported platforms enabled.
pub fn ensure_hooks_from_preferences() -> Result<(), String> {
    let _guard = operation_guard()?;
    let preferences = read_preferences()?;
    let executable = std::env::current_exe()
        .map_err(|err| format!("Failed to locate ORG2 executable: {err}"))?;
    let mut errors = Vec::new();
    for platform in ALL_SESSION_PROVENANCE_HOOK_PLATFORMS {
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
        Ok::<_, String>(
            ALL_SESSION_PROVENANCE_HOOK_PLATFORMS
                .into_iter()
                .map(|platform| {
                    let (enabled, error) = match config_has_managed_hooks(platform) {
                        Ok(enabled) => (enabled, None),
                        Err(error) => (false, Some(error)),
                    };
                    SessionProvenanceHookStatus {
                        platform,
                        enabled,
                        desired_enabled: preferences.enabled(platform),
                        config_path: platform.config_path().to_string_lossy().into_owned(),
                        error,
                    }
                })
                .collect::<Vec<_>>(),
        )
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
        preferences.set_enabled(platform, enabled);
        write_preferences(&preferences)?;
        // Persist the user's desired state before touching a provider file.
        // If a malformed or read-only config cannot be repaired immediately,
        // startup reconciliation can retry without losing the opt-out.
        let update_error = update_platform(platform, enabled, &executable).err();
        let (installed, inspection_error) = match config_has_managed_hooks(platform) {
            Ok(installed) => (installed, None),
            Err(err) => (false, Some(err)),
        };
        let error = match (update_error, inspection_error) {
            (Some(update), Some(inspection)) => Some(format!(
                "{update}; failed to inspect resulting hook config: {inspection}"
            )),
            (Some(update), None) => Some(update),
            (None, Some(inspection)) => Some(inspection),
            (None, None) => None,
        };
        Ok(SessionProvenanceHookStatus {
            platform,
            enabled: installed,
            desired_enabled: enabled,
            config_path: platform.config_path().to_string_lossy().into_owned(),
            error,
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
    fn codex_config_installs_and_removes_actor_lifecycle_hooks() {
        let mut config = json!({
            "hooks": {
                "SubagentStop": [{
                    "matcher": "explorer",
                    "hooks": [{"type": "command", "command": "user-hook"}]
                }]
            }
        });
        update_codex_platform(
            &mut config,
            true,
            "orgii --session-provenance-hook codex",
            "orgii.exe --session-provenance-hook codex",
        )
        .expect("enable Codex hooks");

        assert_eq!(config["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(
            config["hooks"]["SubagentStart"].as_array().unwrap().len(),
            1
        );
        assert_eq!(config["hooks"]["SubagentStop"].as_array().unwrap().len(), 2);
        assert!(config_has_complete_managed_hooks(
            &config,
            SessionProvenanceHookPlatform::Codex
        ));

        config["hooks"]["SubagentStart"] = json!([]);
        assert!(!config_has_complete_managed_hooks(
            &config,
            SessionProvenanceHookPlatform::Codex
        ));

        update_codex_platform(
            &mut config,
            true,
            "orgii --session-provenance-hook codex",
            "orgii.exe --session-provenance-hook codex",
        )
        .expect("repair incomplete Codex hooks");

        update_codex_platform(&mut config, false, "unused", "unused").expect("disable Codex hooks");
        assert!(config.to_string().contains("user-hook"));
        assert!(!config.to_string().contains(HOOK_MARKER));
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
        assert_eq!(
            config["hooks"]["subagentStart"].as_array().unwrap().len(),
            1
        );
        assert_eq!(config["hooks"]["subagentStop"].as_array().unwrap().len(), 1);
        assert!(config_has_complete_managed_hooks(
            &config,
            SessionProvenanceHookPlatform::Cursor
        ));
        update_cursor_platform(&mut config, false, "unused").expect("disable Cursor hook");
        assert_eq!(config["hooks"]["postToolUse"].as_array().unwrap().len(), 1);
        assert!(config["hooks"]["subagentStart"]
            .as_array()
            .unwrap()
            .is_empty());
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

    #[test]
    fn marker_in_unrelated_config_does_not_report_hooks_enabled() {
        let config = json!({"notes": HOOK_MARKER});
        assert!(!config_has_complete_managed_hooks(
            &config,
            SessionProvenanceHookPlatform::ClaudeCode
        ));
    }

    #[test]
    fn future_preferences_fail_closed_instead_of_being_clobbered() {
        assert!(serde_json::from_value::<HookPreferences>(json!({
            "schemaVersion": 2,
            "claudeCode": true,
            "codex": true,
            "cursor": true,
            "futurePlatform": true
        }))
        .is_err());
    }

    #[test]
    fn atomic_write_replaces_an_existing_config() {
        let temp = tempfile::tempdir().expect("temporary config dir");
        let path = temp.path().join("hooks.json");
        std::fs::write(&path, b"old").expect("old config");

        write_atomic(&path, b"new").expect("replace config");

        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }
}
