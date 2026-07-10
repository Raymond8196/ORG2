//! Managed CLI config profiles.
//!
//! This module owns the Default <-> ORGII Managed switch for CLI config files.
//! The first managed agents expose stable user-level config files and can route
//! model traffic through a local proxy without MITM interception.

use app_paths as paths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CODEX_AGENT: &str = "codex";
const CODEX_CONFIG_FILE_ID: &str = "config";
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";
const CLAUDE_CODE_AGENT: &str = "claude_code";
const CLAUDE_CODE_CONFIG_FILE_ID: &str = "settings";
const CLAUDE_CODE_CONFIG_FILE_NAME: &str = "settings.json";
const GEMINI_CLI_AGENT: &str = "gemini_cli";
const GEMINI_CLI_SETTINGS_FILE_ID: &str = "settings";
const GEMINI_CLI_SETTINGS_FILE_NAME: &str = "settings.json";
const GEMINI_CLI_ENV_FILE_ID: &str = "env";
const GEMINI_CLI_ENV_FILE_NAME: &str = ".env";
const DEFAULT_PROXY_URL: &str = "http://127.0.0.1:17888";
const ORGII_PROVIDER_ID: &str = "orgii";
const ORGII_PROVIDER_NAME: &str = "ORGII";
const DEFAULT_ORGII_MODEL: &str = "orgii-current-model";
const ORGII_PROXY_TOKEN: &str = "orgii-managed-proxy";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CliConfigMode {
    Default,
    OrgiiManaged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfigTargetFileManifest {
    pub id: String,
    pub target_path: String,
    pub default_backup_path: String,
    pub managed_profile_path: String,
    pub original_hash: Option<String>,
    pub last_applied_hash: Option<String>,
    #[serde(default)]
    pub default_was_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfigProfileManifest {
    pub agent: String,
    pub mode: CliConfigMode,
    pub target_files: Vec<CliConfigTargetFileManifest>,
    pub selected_key_id: Option<String>,
    pub selected_provider: Option<String>,
    pub selected_model: Option<String>,
    pub proxy_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfigTargetFileStatus {
    pub id: String,
    pub target_path: String,
    pub default_backup_path: String,
    pub managed_profile_path: String,
    pub target_exists: bool,
    pub has_default_backup: bool,
    pub default_was_missing: bool,
    pub original_hash: Option<String>,
    pub last_applied_hash: Option<String>,
    pub current_hash: Option<String>,
    pub conflict: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfigManagedStatus {
    pub agent_name: String,
    pub supported: bool,
    pub mode: CliConfigMode,
    pub has_default_backup: bool,
    pub conflict: bool,
    pub selected_key_id: Option<String>,
    pub selected_provider: Option<String>,
    pub selected_model: Option<String>,
    pub proxy_url: Option<String>,
    pub target_files: Vec<CliConfigTargetFileStatus>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliManagedConfigSelection {
    pub agent_name: String,
    pub mode: CliConfigMode,
    pub selected_key_id: Option<String>,
    pub selected_provider: Option<String>,
    pub selected_model: Option<String>,
    pub proxy_url: Option<String>,
}

fn codex_config_path() -> PathBuf {
    paths::home_dir().join(".codex").join(CODEX_CONFIG_FILE_NAME)
}

fn claude_code_config_path() -> PathBuf {
    paths::home_dir()
        .join(".claude")
        .join(CLAUDE_CODE_CONFIG_FILE_NAME)
}

fn gemini_cli_settings_path() -> PathBuf {
    paths::home_dir()
        .join(".gemini")
        .join(GEMINI_CLI_SETTINGS_FILE_NAME)
}

fn gemini_cli_env_path() -> PathBuf {
    paths::home_dir()
        .join(".gemini")
        .join(GEMINI_CLI_ENV_FILE_NAME)
}

fn default_backup_path(agent_name: &str, file_name: &str) -> PathBuf {
    paths::cli_config_profile_default_dir(agent_name).join(file_name)
}

fn managed_profile_path(agent_name: &str, file_name: &str) -> PathBuf {
    paths::cli_config_profile_orgii_dir(agent_name).join(file_name)
}

fn manifest_path(agent_name: &str) -> PathBuf {
    paths::cli_config_profile_manifest(agent_name)
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

fn file_hash(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)
        .map_err(|err| format!("Failed to read {} for hashing: {err}", path.display()))?;
    Ok(Some(sha256_bytes(&bytes)))
}

fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|err| format!("Failed to create {}: {err}", dir.display()))?;
    }

    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("file")
    ));
    {
        let mut file = std::fs::File::create(&tmp)
            .map_err(|err| format!("Failed to create {}: {err}", tmp.display()))?;
        use std::io::Write;
        file.write_all(bytes)
            .map_err(|err| format!("Failed to write {}: {err}", tmp.display()))?;
        file.sync_all()
            .map_err(|err| format!("Failed to flush {}: {err}", tmp.display()))?;
    }

    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|err| format!("Failed to replace {}: {err}", path.display()))?;
    }

    std::fs::rename(&tmp, path)
        .map_err(|err| format!("Failed to move {} to {}: {err}", tmp.display(), path.display()))?;
    Ok(())
}

fn read_manifest(agent_name: &str) -> Result<Option<CliConfigProfileManifest>, String> {
    let path = manifest_path(agent_name);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    serde_json::from_str(&raw).map_err(|err| format!("Invalid {}: {err}", path.display()))
}

fn write_manifest(manifest: &CliConfigProfileManifest) -> Result<(), String> {
    let path = manifest_path(&manifest.agent);
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|err| format!("Failed to serialize CLI config manifest: {err}"))?;
    write_file_atomic(&path, &bytes)?;
    app_paths::set_sensitive_file_permissions(&path).ok();
    Ok(())
}

fn manifest_target(agent_name: &str, file_id: &str, file_name: &str, target_path: &Path) -> CliConfigTargetFileManifest {
    CliConfigTargetFileManifest {
        id: file_id.to_string(),
        target_path: target_path.to_string_lossy().to_string(),
        default_backup_path: default_backup_path(agent_name, file_name)
            .to_string_lossy()
            .to_string(),
        managed_profile_path: managed_profile_path(agent_name, file_name)
            .to_string_lossy()
            .to_string(),
        original_hash: None,
        last_applied_hash: None,
        default_was_missing: false,
    }
}

fn supported_agent(agent_name: &str) -> bool {
    matches!(agent_name, CODEX_AGENT | CLAUDE_CODE_AGENT | GEMINI_CLI_AGENT)
}

fn agent_manifest_targets(agent_name: &str) -> Option<Vec<CliConfigTargetFileManifest>> {
    match agent_name {
        CODEX_AGENT => Some(vec![manifest_target(
            CODEX_AGENT,
            CODEX_CONFIG_FILE_ID,
            CODEX_CONFIG_FILE_NAME,
            &codex_config_path(),
        )]),
        CLAUDE_CODE_AGENT => Some(vec![manifest_target(
            CLAUDE_CODE_AGENT,
            CLAUDE_CODE_CONFIG_FILE_ID,
            CLAUDE_CODE_CONFIG_FILE_NAME,
            &claude_code_config_path(),
        )]),
        GEMINI_CLI_AGENT => Some(vec![
            manifest_target(
                GEMINI_CLI_AGENT,
                GEMINI_CLI_SETTINGS_FILE_ID,
                GEMINI_CLI_SETTINGS_FILE_NAME,
                &gemini_cli_settings_path(),
            ),
            manifest_target(
                GEMINI_CLI_AGENT,
                GEMINI_CLI_ENV_FILE_ID,
                GEMINI_CLI_ENV_FILE_NAME,
                &gemini_cli_env_path(),
            ),
        ]),
        _ => None,
    }
}

fn targets_with_fallbacks(
    manifest: Option<&CliConfigProfileManifest>,
    fallback_targets: &[CliConfigTargetFileManifest],
) -> Vec<CliConfigTargetFileManifest> {
    let mut by_id: BTreeMap<String, CliConfigTargetFileManifest> = manifest
        .map(|manifest| {
            manifest
                .target_files
                .iter()
                .cloned()
                .map(|target| (target.id.clone(), target))
                .collect()
        })
        .unwrap_or_default();

    for target in fallback_targets {
        by_id.entry(target.id.clone()).or_insert_with(|| target.clone());
    }

    let mut targets = Vec::new();
    for fallback in fallback_targets {
        if let Some(target) = by_id.remove(&fallback.id) {
            targets.push(target);
        }
    }
    targets.extend(by_id.into_values());
    targets
}

fn status_for(agent_name: &str) -> Result<CliConfigManagedStatus, String> {
    if !supported_agent(agent_name) {
        return Ok(CliConfigManagedStatus {
            agent_name: agent_name.to_string(),
            supported: false,
            mode: CliConfigMode::Default,
            has_default_backup: false,
            conflict: false,
            selected_key_id: None,
            selected_provider: None,
            selected_model: None,
            proxy_url: None,
            target_files: Vec::new(),
            message: Some("ORGII managed config is not available for this CLI yet".to_string()),
        });
    }

    let manifest = read_manifest(agent_name)?;
    let fallback_targets = agent_manifest_targets(agent_name)
        .ok_or_else(|| format!("Unsupported CLI managed config agent: {agent_name}"))?;
    let (mode, selected_key_id, selected_provider, selected_model, proxy_url, targets) =
        if let Some(manifest) = &manifest {
            (
                manifest.mode,
                manifest.selected_key_id.clone(),
                manifest.selected_provider.clone(),
                manifest.selected_model.clone(),
                manifest.proxy_url.clone(),
                targets_with_fallbacks(Some(manifest), &fallback_targets),
            )
        } else {
            (
                CliConfigMode::Default,
                None,
                None,
                None,
                Some(DEFAULT_PROXY_URL.to_string()),
                fallback_targets,
            )
        };

    let mut any_backup = false;
    let mut any_conflict = false;
    let target_files: Vec<CliConfigTargetFileStatus> = targets
        .into_iter()
        .map(|target| {
            let target_path = PathBuf::from(&target.target_path);
            let default_backup_path = PathBuf::from(&target.default_backup_path);
            let current_hash = file_hash(&target_path)?;
            let has_default_backup = target.default_was_missing || default_backup_path.exists();
            let conflict = mode == CliConfigMode::OrgiiManaged
                && target.last_applied_hash.is_some()
                && current_hash != target.last_applied_hash;
            any_backup |= has_default_backup;
            any_conflict |= conflict;
            Ok(CliConfigTargetFileStatus {
                id: target.id,
                target_path: target.target_path,
                default_backup_path: target.default_backup_path,
                managed_profile_path: target.managed_profile_path,
                target_exists: target_path.exists(),
                has_default_backup,
                default_was_missing: target.default_was_missing,
                original_hash: target.original_hash,
                last_applied_hash: target.last_applied_hash,
                current_hash,
                conflict,
            })
        })
        .collect::<Result<_, String>>()?;

    Ok(CliConfigManagedStatus {
        agent_name: agent_name.to_string(),
        supported: true,
        mode,
        has_default_backup: any_backup,
        conflict: any_conflict,
        selected_key_id,
        selected_provider,
        selected_model,
        proxy_url,
        target_files,
        message: None,
    })
}

pub fn managed_selection_for_agent(
    agent_name: &str,
) -> Result<Option<CliManagedConfigSelection>, String> {
    if !supported_agent(agent_name) {
        return Ok(None);
    }

    let Some(manifest) = read_manifest(agent_name)? else {
        return Ok(None);
    };

    if manifest.mode != CliConfigMode::OrgiiManaged {
        return Ok(None);
    }

    Ok(Some(CliManagedConfigSelection {
        agent_name: manifest.agent,
        mode: manifest.mode,
        selected_key_id: manifest.selected_key_id,
        selected_provider: manifest.selected_provider,
        selected_model: manifest.selected_model,
        proxy_url: manifest.proxy_url,
    }))
}

fn codex_proxy_base_url(proxy_url: &str) -> String {
    let trimmed = proxy_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1")
    }
}

fn claude_code_proxy_base_url(proxy_url: &str) -> String {
    let trimmed = proxy_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/claude/v1") {
        trimmed.trim_end_matches("/v1").to_string()
    } else if trimmed.ends_with("/claude") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/claude")
    }
}

fn gemini_cli_proxy_base_url(proxy_url: &str) -> String {
    let trimmed = proxy_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/gemini") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/gemini")
    }
}

fn generate_codex_managed_config(
    existing_content: &str,
    selected_model: Option<&str>,
    proxy_url: &str,
) -> Result<String, String> {
    let mut config: toml::Value = if existing_content.trim().is_empty() {
        toml::Value::Table(toml::map::Map::new())
    } else {
        toml::from_str(existing_content).map_err(|err| format!("Invalid Codex TOML: {err}"))?
    };

    let Some(root) = config.as_table_mut() else {
        return Err("Codex config must be a TOML table".to_string());
    };

    let model = selected_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_ORGII_MODEL);
    root.insert("model".to_string(), toml::Value::String(model.to_string()));
    root.insert(
        "model_provider".to_string(),
        toml::Value::String(ORGII_PROVIDER_ID.to_string()),
    );

    if !matches!(root.get("model_providers"), Some(toml::Value::Table(_))) {
        root.insert(
            "model_providers".to_string(),
            toml::Value::Table(toml::map::Map::new()),
        );
    }

    let Some(toml::Value::Table(providers)) = root.get_mut("model_providers") else {
        return Err("Failed to build Codex model_providers table".to_string());
    };

    let mut orgii = toml::map::Map::new();
    orgii.insert(
        "name".to_string(),
        toml::Value::String(ORGII_PROVIDER_NAME.to_string()),
    );
    orgii.insert(
        "base_url".to_string(),
        toml::Value::String(codex_proxy_base_url(proxy_url)),
    );
    orgii.insert(
        "requires_openai_auth".to_string(),
        toml::Value::Boolean(false),
    );
    orgii.insert(
        "wire_api".to_string(),
        toml::Value::String("responses".to_string()),
    );
    providers.insert(ORGII_PROVIDER_ID.to_string(), toml::Value::Table(orgii));

    toml::to_string_pretty(&config).map_err(|err| format!("TOML serialize error: {err}"))
}

fn selected_model_or_default(selected_model: Option<&str>) -> &str {
    selected_model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_ORGII_MODEL)
}

fn generate_claude_code_managed_config(
    existing_content: &str,
    selected_model: Option<&str>,
    proxy_url: &str,
) -> Result<String, String> {
    let mut config: serde_json::Value = if existing_content.trim().is_empty() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        serde_json::from_str(existing_content)
            .map_err(|err| format!("Invalid Claude Code JSON: {err}"))?
    };

    let Some(root) = config.as_object_mut() else {
        return Err("Claude Code settings must be a JSON object".to_string());
    };

    let model = selected_model_or_default(selected_model);
    root.insert(
        "model".to_string(),
        serde_json::Value::String(model.to_string()),
    );

    if !matches!(root.get("env"), Some(serde_json::Value::Object(_))) {
        root.insert(
            "env".to_string(),
            serde_json::Value::Object(serde_json::Map::new()),
        );
    }

    let Some(serde_json::Value::Object(env)) = root.get_mut("env") else {
        return Err("Failed to build Claude Code env object".to_string());
    };

    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        serde_json::Value::String(ORGII_PROXY_TOKEN.to_string()),
    );
    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        serde_json::Value::String(claude_code_proxy_base_url(proxy_url)),
    );
    env.insert(
        "ANTHROPIC_MODEL".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    env.insert(
        "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    env.insert(
        "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS".to_string(),
        serde_json::Value::String("1".to_string()),
    );
    env.insert(
        "DISABLE_INTERLEAVED_THINKING".to_string(),
        serde_json::Value::String("1".to_string()),
    );

    serde_json::to_string_pretty(&config)
        .map(|value| format!("{value}\n"))
        .map_err(|err| format!("JSON serialize error: {err}"))
}

fn generate_gemini_cli_settings_config(existing_content: &str) -> Result<String, String> {
    let mut config: serde_json::Value = if existing_content.trim().is_empty() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        serde_json::from_str(existing_content)
            .map_err(|err| format!("Invalid Gemini CLI JSON: {err}"))?
    };

    let Some(root) = config.as_object_mut() else {
        return Err("Gemini CLI settings must be a JSON object".to_string());
    };

    if !matches!(root.get("security"), Some(serde_json::Value::Object(_))) {
        root.insert(
            "security".to_string(),
            serde_json::Value::Object(serde_json::Map::new()),
        );
    }
    let Some(serde_json::Value::Object(security)) = root.get_mut("security") else {
        return Err("Failed to build Gemini CLI security object".to_string());
    };

    if !matches!(security.get("auth"), Some(serde_json::Value::Object(_))) {
        security.insert(
            "auth".to_string(),
            serde_json::Value::Object(serde_json::Map::new()),
        );
    }
    let Some(serde_json::Value::Object(auth)) = security.get_mut("auth") else {
        return Err("Failed to build Gemini CLI auth object".to_string());
    };

    auth.insert(
        "selectedType".to_string(),
        serde_json::Value::String("gemini-api-key".to_string()),
    );

    serde_json::to_string_pretty(&config)
        .map(|value| format!("{value}\n"))
        .map_err(|err| format!("JSON serialize error: {err}"))
}

fn quote_env_value(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn env_line_key(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let trimmed = trimmed.strip_prefix("export ").unwrap_or(trimmed);
    let (key, _) = trimmed.split_once('=')?;
    let key = key.trim();
    if key.is_empty()
        || !key
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(key.to_string())
}

fn upsert_env_file(existing_content: &str, values: &[(&str, String)]) -> String {
    let replacements: BTreeMap<&str, String> = values.iter().cloned().collect();
    let mut seen = BTreeSet::new();
    let mut lines = Vec::new();

    for line in existing_content.lines() {
        if let Some(key) = env_line_key(line) {
            if let Some(value) = replacements.get(key.as_str()) {
                if seen.insert(key.clone()) {
                    lines.push(format!("{key}={}", quote_env_value(value)));
                }
                continue;
            }
        }
        lines.push(line.to_string());
    }

    for (key, value) in values {
        if !seen.contains(*key) {
            lines.push(format!("{key}={}", quote_env_value(value)));
        }
    }

    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

fn generate_gemini_cli_env_config(
    existing_content: &str,
    selected_model: Option<&str>,
    proxy_url: &str,
) -> String {
    let model = selected_model_or_default(selected_model).to_string();
    upsert_env_file(
        existing_content,
        &[
            ("GEMINI_API_KEY", ORGII_PROXY_TOKEN.to_string()),
            ("GOOGLE_API_KEY", ORGII_PROXY_TOKEN.to_string()),
            ("GEMINI_MODEL", model),
            (
                "GOOGLE_GEMINI_BASE_URL",
                gemini_cli_proxy_base_url(proxy_url),
            ),
        ],
    )
}

fn generate_managed_configs(
    agent_name: &str,
    existing_contents: &BTreeMap<String, String>,
    selected_model: Option<&str>,
    proxy_url: &str,
) -> Result<BTreeMap<String, String>, String> {
    let content = |file_id: &str| {
        existing_contents
            .get(file_id)
            .map(String::as_str)
            .unwrap_or("")
    };
    let mut files = BTreeMap::new();
    match agent_name {
        CODEX_AGENT => {
            files.insert(
                CODEX_CONFIG_FILE_ID.to_string(),
                generate_codex_managed_config(
                    content(CODEX_CONFIG_FILE_ID),
                    selected_model,
                    proxy_url,
                )?,
            );
            Ok(files)
        }
        CLAUDE_CODE_AGENT => {
            files.insert(
                CLAUDE_CODE_CONFIG_FILE_ID.to_string(),
                generate_claude_code_managed_config(
                    content(CLAUDE_CODE_CONFIG_FILE_ID),
                    selected_model,
                    proxy_url,
                )?,
            );
            Ok(files)
        }
        GEMINI_CLI_AGENT => {
            files.insert(
                GEMINI_CLI_SETTINGS_FILE_ID.to_string(),
                generate_gemini_cli_settings_config(content(GEMINI_CLI_SETTINGS_FILE_ID))?,
            );
            files.insert(
                GEMINI_CLI_ENV_FILE_ID.to_string(),
                generate_gemini_cli_env_config(
                    content(GEMINI_CLI_ENV_FILE_ID),
                    selected_model,
                    proxy_url,
                ),
            );
            Ok(files)
        }
        _ => Err(format!(
            "ORGII managed config is not available for {agent_name} in this build"
        )),
    }
}

fn ensure_default_backup(
    mut target: CliConfigTargetFileManifest,
    refresh_existing: bool,
) -> Result<CliConfigTargetFileManifest, String> {
    let target_path = PathBuf::from(&target.target_path);
    let backup_path = PathBuf::from(&target.default_backup_path);
    if !refresh_existing && (target.default_was_missing || backup_path.exists()) {
        return Ok(target);
    }

    if target_path.exists() {
        let bytes = std::fs::read(&target_path)
            .map_err(|err| format!("Failed to read {}: {err}", target_path.display()))?;
        target.original_hash = Some(sha256_bytes(&bytes));
        target.default_was_missing = false;
        write_file_atomic(&backup_path, &bytes)?;
        app_paths::set_sensitive_file_permissions(&backup_path).ok();
    } else {
        target.original_hash = None;
        target.default_was_missing = true;
        if refresh_existing && backup_path.exists() {
            std::fs::remove_file(&backup_path)
                .map_err(|err| format!("Failed to remove {}: {err}", backup_path.display()))?;
        }
        if let Some(dir) = backup_path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|err| format!("Failed to create {}: {err}", dir.display()))?;
        }
    }

    Ok(target)
}

fn enable_agent_orgii_managed(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    proxy_url: Option<String>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    let fallback_targets = agent_manifest_targets(agent_name)
        .ok_or_else(|| format!("Unsupported CLI managed config agent: {agent_name}"))?;
    let existing_manifest = read_manifest(agent_name)?;
    let targets = targets_with_fallbacks(existing_manifest.as_ref(), &fallback_targets);
    let mut current_contents = BTreeMap::new();

    for target in &targets {
        let target_path = PathBuf::from(&target.target_path);
        let content = if target_path.exists() {
            std::fs::read_to_string(&target_path)
                .map_err(|err| format!("Failed to read {}: {err}", target_path.display()))?
        } else {
            String::new()
        };
        current_contents.insert(target.id.clone(), content);
    }

    let proxy_url = proxy_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_PROXY_URL.to_string());
    let managed_contents =
        generate_managed_configs(agent_name, &current_contents, model.as_deref(), &proxy_url)?;

    if let Some(existing_manifest) = &existing_manifest {
        if existing_manifest.mode == CliConfigMode::OrgiiManaged && !force {
            for target in &existing_manifest.target_files {
                if let Some(last_hash) = &target.last_applied_hash {
                    let current_hash = file_hash(Path::new(&target.target_path))?;
                    if current_hash.as_ref() != Some(last_hash) {
                        return Err(
                            "Current CLI config was modified outside ORGII. Restore or force apply before overwriting it."
                                .to_string(),
                        );
                    }
                }
            }
        }
    }

    let now = now_stamp();
    let refresh_default_backup = existing_manifest
        .as_ref()
        .is_none_or(|manifest| manifest.mode == CliConfigMode::Default);
    let mut manifest = existing_manifest.unwrap_or_else(|| CliConfigProfileManifest {
        agent: agent_name.to_string(),
        mode: CliConfigMode::Default,
        target_files: fallback_targets.clone(),
        selected_key_id: None,
        selected_provider: None,
        selected_model: None,
        proxy_url: Some(DEFAULT_PROXY_URL.to_string()),
        created_at: now.clone(),
        updated_at: now.clone(),
    });

    let mut managed_targets = Vec::new();
    for target in targets {
        let Some(managed_content) = managed_contents.get(&target.id) else {
            continue;
        };
        let mut target = ensure_default_backup(target, refresh_default_backup)?;
        let managed_hash = sha256_bytes(managed_content.as_bytes());
        let target_path = PathBuf::from(&target.target_path);

        let managed_path = PathBuf::from(&target.managed_profile_path);
        write_file_atomic(&managed_path, managed_content.as_bytes())?;
        app_paths::set_sensitive_file_permissions(&managed_path).ok();
        write_file_atomic(&target_path, managed_content.as_bytes())?;

        target.last_applied_hash = Some(managed_hash);
        target.target_path = target_path.to_string_lossy().to_string();
        managed_targets.push(target);
    }

    manifest.mode = CliConfigMode::OrgiiManaged;
    manifest.target_files = managed_targets;
    manifest.selected_key_id = key_id;
    manifest.selected_provider = provider;
    manifest.selected_model = model;
    manifest.proxy_url = Some(proxy_url);
    manifest.updated_at = now_stamp();
    write_manifest(&manifest)?;
    status_for(agent_name)
}

fn restore_agent_default(agent_name: &str, force: bool) -> Result<CliConfigManagedStatus, String> {
    let mut manifest = read_manifest(agent_name)?
        .ok_or_else(|| format!("No Default backup exists for {agent_name} yet"))?;

    for target in &manifest.target_files {
        if manifest.mode == CliConfigMode::OrgiiManaged && !force {
            if let Some(last_hash) = &target.last_applied_hash {
                let current_hash = file_hash(Path::new(&target.target_path))?;
                if current_hash.as_ref() != Some(last_hash) {
                    return Err(
                        "Current CLI config was modified outside ORGII. Force restore to overwrite it."
                            .to_string(),
                    );
                }
            }
        }

        let target_path = PathBuf::from(&target.target_path);
        if target.default_was_missing {
            if target_path.exists() {
                std::fs::remove_file(&target_path)
                    .map_err(|err| format!("Failed to remove {}: {err}", target_path.display()))?;
            }
        } else {
            let backup_path = PathBuf::from(&target.default_backup_path);
            if !backup_path.exists() {
                return Err(format!(
                    "Default backup does not exist: {}",
                    backup_path.display()
                ));
            }
            let bytes = std::fs::read(&backup_path)
                .map_err(|err| format!("Failed to read {}: {err}", backup_path.display()))?;
            write_file_atomic(&target_path, &bytes)?;
        }
    }

    manifest.mode = CliConfigMode::Default;
    manifest.updated_at = now_stamp();
    write_manifest(&manifest)?;
    status_for(agent_name)
}

fn set_agent_selection(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<CliConfigManagedStatus, String> {
    let mut manifest =
        read_manifest(agent_name)?.ok_or_else(|| format!("{agent_name} is not managed by ORGII yet"))?;
    manifest.selected_key_id = key_id;
    manifest.selected_provider = provider;
    manifest.selected_model = model;
    manifest.updated_at = now_stamp();
    write_manifest(&manifest)?;
    status_for(agent_name)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_get_status(agent_name: String) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || status_for(&agent_name))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_enable_orgii_managed(
    agent_name: String,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    proxy_url: Option<String>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || {
        if !supported_agent(&agent_name) {
            return Err(format!(
                "ORGII managed config is not available for {agent_name} in this build"
            ));
        }
        enable_agent_orgii_managed(&agent_name, key_id, provider, model, proxy_url, force)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_set_selection(
    agent_name: String,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || {
        if !supported_agent(&agent_name) {
            return Err(format!(
                "ORGII managed config is not available for {agent_name} in this build"
            ));
        }
        set_agent_selection(&agent_name, key_id, provider, model)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_restore_default(
    agent_name: String,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || {
        if !supported_agent(&agent_name) {
            return Err(format!(
                "ORGII managed config is not available for {agent_name} in this build"
            ));
        }
        restore_agent_default(&agent_name, force)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_managed_config_preserves_existing_settings() {
        let raw = r#"
model = "gpt-5"
approval_policy = "on-request"

[features]
shell_tool = true
"#;

        let generated =
            generate_codex_managed_config(raw, Some("gpt-5-codex"), DEFAULT_PROXY_URL).unwrap();
        let parsed: toml::Value = toml::from_str(&generated).unwrap();

        assert_eq!(parsed["model"].as_str(), Some("gpt-5-codex"));
        assert_eq!(parsed["model_provider"].as_str(), Some("orgii"));
        assert_eq!(parsed["approval_policy"].as_str(), Some("on-request"));
        assert_eq!(parsed["features"]["shell_tool"].as_bool(), Some(true));
        assert_eq!(
            parsed["model_providers"]["orgii"]["base_url"].as_str(),
            Some("http://127.0.0.1:17888/v1")
        );
        assert!(parsed["model_providers"]["orgii"].get("env_key").is_none());
        assert_eq!(
            parsed["model_providers"]["orgii"]["requires_openai_auth"].as_bool(),
            Some(false)
        );
    }

    #[test]
    fn codex_managed_config_uses_placeholder_model_when_missing() {
        let generated = generate_codex_managed_config("", None, "http://localhost:9999/v1").unwrap();
        let parsed: toml::Value = toml::from_str(&generated).unwrap();

        assert_eq!(parsed["model"].as_str(), Some(DEFAULT_ORGII_MODEL));
        assert_eq!(
            parsed["model_providers"]["orgii"]["base_url"].as_str(),
            Some("http://localhost:9999/v1")
        );
    }

    #[test]
    fn claude_code_managed_config_preserves_existing_settings() {
        let raw = r#"
{
  "permissions": {
    "allow": ["Bash(git status:*)"]
  },
  "env": {
    "CUSTOM_FLAG": "keep"
  }
}
"#;

        let generated =
            generate_claude_code_managed_config(raw, Some("claude-sonnet-4-5"), DEFAULT_PROXY_URL)
                .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&generated).unwrap();

        assert_eq!(parsed["model"].as_str(), Some("claude-sonnet-4-5"));
        assert_eq!(
            parsed["permissions"]["allow"][0].as_str(),
            Some("Bash(git status:*)")
        );
        assert_eq!(parsed["env"]["CUSTOM_FLAG"].as_str(), Some("keep"));
        assert_eq!(
            parsed["env"]["ANTHROPIC_BASE_URL"].as_str(),
            Some("http://127.0.0.1:17888/claude")
        );
        assert_eq!(
            parsed["env"]["ANTHROPIC_AUTH_TOKEN"].as_str(),
            Some(ORGII_PROXY_TOKEN)
        );
        assert_eq!(
            parsed["env"]["ANTHROPIC_MODEL"].as_str(),
            Some("claude-sonnet-4-5")
        );
    }

    #[test]
    fn claude_code_proxy_base_url_is_idempotent() {
        assert_eq!(
            claude_code_proxy_base_url("http://127.0.0.1:17888"),
            "http://127.0.0.1:17888/claude"
        );
        assert_eq!(
            claude_code_proxy_base_url("http://127.0.0.1:17888/claude"),
            "http://127.0.0.1:17888/claude"
        );
        assert_eq!(
            claude_code_proxy_base_url("http://127.0.0.1:17888/claude/v1"),
            "http://127.0.0.1:17888/claude"
        );
    }

    #[test]
    fn gemini_cli_managed_config_preserves_settings_and_writes_env() {
        let settings = r#"
{
  "ide": {
    "enabled": true
  },
  "security": {
    "auth": {
      "selectedType": "oauth-personal"
    }
  }
}
"#;
        let env = r#"
CUSTOM_FLAG=keep
GEMINI_API_KEY="old-key"
export GOOGLE_GEMINI_BASE_URL="https://old.example.com"
"#;
        let mut existing = BTreeMap::new();
        existing.insert(GEMINI_CLI_SETTINGS_FILE_ID.to_string(), settings.to_string());
        existing.insert(GEMINI_CLI_ENV_FILE_ID.to_string(), env.to_string());

        let generated = generate_managed_configs(
            GEMINI_CLI_AGENT,
            &existing,
            Some("gemini-2.5-pro"),
            DEFAULT_PROXY_URL,
        )
        .unwrap();
        let generated_settings: serde_json::Value =
            serde_json::from_str(&generated[GEMINI_CLI_SETTINGS_FILE_ID]).unwrap();
        let generated_env = &generated[GEMINI_CLI_ENV_FILE_ID];

        assert_eq!(generated_settings["ide"]["enabled"].as_bool(), Some(true));
        assert_eq!(
            generated_settings["security"]["auth"]["selectedType"].as_str(),
            Some("gemini-api-key")
        );
        assert!(generated_env.contains("CUSTOM_FLAG=keep"));
        assert!(generated_env.contains("GEMINI_API_KEY=\"orgii-managed-proxy\""));
        assert!(generated_env.contains("GOOGLE_API_KEY=\"orgii-managed-proxy\""));
        assert!(generated_env.contains("GEMINI_MODEL=\"gemini-2.5-pro\""));
        assert!(
            generated_env.contains("GOOGLE_GEMINI_BASE_URL=\"http://127.0.0.1:17888/gemini\"")
        );
        assert!(!generated_env.contains("old-key"));
        assert!(!generated_env.contains("https://old.example.com"));
    }

    #[test]
    fn gemini_cli_manifest_tracks_settings_and_env() {
        let targets = agent_manifest_targets(GEMINI_CLI_AGENT).unwrap();
        let ids: Vec<_> = targets.iter().map(|target| target.id.as_str()).collect();

        assert_eq!(ids, vec![GEMINI_CLI_SETTINGS_FILE_ID, GEMINI_CLI_ENV_FILE_ID]);
    }

    #[test]
    fn gemini_cli_proxy_base_url_is_idempotent() {
        assert_eq!(
            gemini_cli_proxy_base_url("http://127.0.0.1:17888"),
            "http://127.0.0.1:17888/gemini"
        );
        assert_eq!(
            gemini_cli_proxy_base_url("http://127.0.0.1:17888/gemini"),
            "http://127.0.0.1:17888/gemini"
        );
    }
}
