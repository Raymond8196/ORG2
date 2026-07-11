//! Managed CLI config profiles.
//!
//! This module owns the Default <-> ORGII Managed switch for CLI config files.
//! The first managed agents expose stable user-level config files and can route
//! model traffic through a local proxy without MITM interception.

use app_paths as paths;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
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
const OPENCODE_AGENT: &str = "opencode";
const OPENCODE_CONFIG_FILE_ID: &str = "config";
const OPENCODE_CONFIG_FILE_NAME: &str = "opencode.jsonc";
const AIDER_AGENT: &str = "aider";
const AIDER_CONFIG_FILE_ID: &str = "config";
const AIDER_CONFIG_FILE_NAME: &str = ".aider.conf.yml";
const DEFAULT_PROXY_URL: &str = "http://127.0.0.1:17888";
const ORGII_PROVIDER_ID: &str = "orgii";
const ORGII_PROVIDER_NAME: &str = "ORGII";
const DEFAULT_ORGII_MODEL: &str = "orgii-current-model";
const TRANSACTION_DIR_NAME: &str = "transaction";
const TRANSACTION_JOURNAL_FILE_NAME: &str = "journal.json";

static CONFIG_OPERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliManagedProxyProtocol {
    OpenAiResponses,
    OpenAiChatCompletions,
    AnthropicMessages,
    GeminiGenerateContent,
}

#[derive(Debug, Clone, Copy)]
enum ManagedConfigGenerator {
    CodexToml,
    ClaudeCodeJson,
    GeminiSettingsJson,
    GeminiEnv,
    OpenCodeJsonc,
    AiderYaml,
}

#[derive(Debug, Clone, Copy)]
struct ManagedConfigTargetSpec {
    file_id: &'static str,
    profile_file_name: &'static str,
    generator: ManagedConfigGenerator,
}

#[derive(Debug, Clone, Copy)]
struct CliManagedConfigAdapter {
    agent_name: &'static str,
    proxy_protocol: CliManagedProxyProtocol,
    targets: &'static [ManagedConfigTargetSpec],
}

const CODEX_TARGETS: &[ManagedConfigTargetSpec] = &[managed_target(
    CODEX_CONFIG_FILE_ID,
    CODEX_CONFIG_FILE_NAME,
    ManagedConfigGenerator::CodexToml,
)];
const CLAUDE_CODE_TARGETS: &[ManagedConfigTargetSpec] = &[managed_target(
    CLAUDE_CODE_CONFIG_FILE_ID,
    CLAUDE_CODE_CONFIG_FILE_NAME,
    ManagedConfigGenerator::ClaudeCodeJson,
)];
const GEMINI_CLI_TARGETS: &[ManagedConfigTargetSpec] = &[
    managed_target(
        GEMINI_CLI_SETTINGS_FILE_ID,
        GEMINI_CLI_SETTINGS_FILE_NAME,
        ManagedConfigGenerator::GeminiSettingsJson,
    ),
    managed_target(
        GEMINI_CLI_ENV_FILE_ID,
        GEMINI_CLI_ENV_FILE_NAME,
        ManagedConfigGenerator::GeminiEnv,
    ),
];
const OPENCODE_TARGETS: &[ManagedConfigTargetSpec] = &[managed_target(
    OPENCODE_CONFIG_FILE_ID,
    OPENCODE_CONFIG_FILE_NAME,
    ManagedConfigGenerator::OpenCodeJsonc,
)];
const AIDER_TARGETS: &[ManagedConfigTargetSpec] = &[managed_target(
    AIDER_CONFIG_FILE_ID,
    AIDER_CONFIG_FILE_NAME,
    ManagedConfigGenerator::AiderYaml,
)];

const MANAGED_CONFIG_ADAPTERS: &[CliManagedConfigAdapter] = &[
    managed_adapter(
        CODEX_AGENT,
        CliManagedProxyProtocol::OpenAiResponses,
        CODEX_TARGETS,
    ),
    managed_adapter(
        CLAUDE_CODE_AGENT,
        CliManagedProxyProtocol::AnthropicMessages,
        CLAUDE_CODE_TARGETS,
    ),
    managed_adapter(
        GEMINI_CLI_AGENT,
        CliManagedProxyProtocol::GeminiGenerateContent,
        GEMINI_CLI_TARGETS,
    ),
    managed_adapter(
        OPENCODE_AGENT,
        CliManagedProxyProtocol::OpenAiChatCompletions,
        OPENCODE_TARGETS,
    ),
    managed_adapter(
        AIDER_AGENT,
        CliManagedProxyProtocol::OpenAiChatCompletions,
        AIDER_TARGETS,
    ),
];

const fn managed_target(
    file_id: &'static str,
    profile_file_name: &'static str,
    generator: ManagedConfigGenerator,
) -> ManagedConfigTargetSpec {
    ManagedConfigTargetSpec {
        file_id,
        profile_file_name,
        generator,
    }
}

const fn managed_adapter(
    agent_name: &'static str,
    proxy_protocol: CliManagedProxyProtocol,
    targets: &'static [ManagedConfigTargetSpec],
) -> CliManagedConfigAdapter {
    CliManagedConfigAdapter {
        agent_name,
        proxy_protocol,
        targets,
    }
}

fn managed_config_adapter(agent_name: &str) -> Option<&'static CliManagedConfigAdapter> {
    MANAGED_CONFIG_ADAPTERS
        .iter()
        .find(|adapter| adapter.agent_name == agent_name)
}

pub fn managed_proxy_protocol_for_agent(agent_name: &str) -> Option<CliManagedProxyProtocol> {
    managed_config_adapter(agent_name).map(|adapter| adapter.proxy_protocol)
}

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
    #[serde(default)]
    pub proxy_token: Option<String>,
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
    pub proxy_token: Option<String>,
}

#[derive(Debug, Clone)]
struct TargetSnapshot {
    id: String,
    target_path: PathBuf,
    existed: bool,
    bytes: Vec<u8>,
    hash: Option<String>,
}

#[derive(Debug, Clone)]
enum TargetMutation {
    Write(Vec<u8>),
    Remove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliConfigTransactionTarget {
    id: String,
    target_path: String,
    rollback_path: String,
    target_existed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliConfigTransactionJournal {
    agent: String,
    final_manifest_hash: String,
    target_files: Vec<CliConfigTransactionTarget>,
    created_at: String,
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

fn transaction_dir(agent_name: &str) -> PathBuf {
    paths::cli_config_profile_agent_dir(agent_name).join(TRANSACTION_DIR_NAME)
}

fn transaction_journal_path(agent_name: &str) -> PathBuf {
    transaction_dir(agent_name).join(TRANSACTION_JOURNAL_FILE_NAME)
}

fn config_operation_guard() -> Result<MutexGuard<'static, ()>, String> {
    CONFIG_OPERATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "CLI config operation lock is poisoned".to_string())
}

fn now_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn generate_proxy_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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

fn unique_temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config");
    path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        now_nanos()
    ))
}

fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|err| format!("Failed to create {}: {err}", dir.display()))?;
    }

    let tmp = unique_temp_path(path);
    let result = (|| {
        let mut file = std::fs::File::create(&tmp)
            .map_err(|err| format!("Failed to create {}: {err}", tmp.display()))?;
        use std::io::Write;
        file.write_all(bytes)
            .map_err(|err| format!("Failed to write {}: {err}", tmp.display()))?;
        file.sync_all()
            .map_err(|err| format!("Failed to flush {}: {err}", tmp.display()))?;
        std::fs::rename(&tmp, path).map_err(|err| {
            format!(
                "Failed to move {} to {}: {err}",
                tmp.display(),
                path.display()
            )
        })?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn write_sensitive_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_file_atomic(path, bytes)?;
    if let Err(err) = app_paths::set_sensitive_file_permissions(path) {
        tracing::warn!(path = %path.display(), error = %err, "Failed to secure CLI config profile file");
    }
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

fn manifest_bytes(manifest: &CliConfigProfileManifest) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(manifest)
        .map_err(|err| format!("Failed to serialize CLI config manifest: {err}"))
}

fn write_manifest(manifest: &CliConfigProfileManifest) -> Result<(), String> {
    let path = manifest_path(&manifest.agent);
    write_sensitive_file_atomic(&path, &manifest_bytes(manifest)?)
}

fn manifest_target(
    agent_name: &str,
    file_id: &str,
    file_name: &str,
    target_path: &Path,
) -> CliConfigTargetFileManifest {
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
    managed_config_adapter(agent_name).is_some()
}

fn agent_manifest_targets(agent_name: &str) -> Result<Vec<CliConfigTargetFileManifest>, String> {
    let adapter = managed_config_adapter(agent_name)
        .ok_or_else(|| format!("Unsupported CLI managed config agent: {agent_name}"))?;
    adapter
        .targets
        .iter()
        .map(|target| {
            let target_path =
                crate::generic_config::resolve_config_path(agent_name, target.file_id)?;
            Ok(manifest_target(
                agent_name,
                target.file_id,
                target.profile_file_name,
                &target_path,
            ))
        })
        .collect()
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
        by_id
            .entry(target.id.clone())
            .or_insert_with(|| target.clone());
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

fn read_target_snapshots(
    targets: &[CliConfigTargetFileManifest],
) -> Result<BTreeMap<String, TargetSnapshot>, String> {
    let mut snapshots = BTreeMap::new();
    for target in targets {
        let target_path = PathBuf::from(&target.target_path);
        let existed = target_path.exists();
        let bytes = if existed {
            std::fs::read(&target_path)
                .map_err(|err| format!("Failed to read {}: {err}", target_path.display()))?
        } else {
            Vec::new()
        };
        let hash = existed.then(|| sha256_bytes(&bytes));
        let snapshot = TargetSnapshot {
            id: target.id.clone(),
            target_path,
            existed,
            bytes,
            hash,
        };
        if snapshots.insert(target.id.clone(), snapshot).is_some() {
            return Err(format!("Duplicate CLI config target id: {}", target.id));
        }
    }
    Ok(snapshots)
}

fn versioned_default_backup_path(
    agent_name: &str,
    target: &CliConfigTargetFileManifest,
    snapshot: &TargetSnapshot,
) -> PathBuf {
    let file_name = Path::new(&target.target_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config");
    let hash = snapshot
        .hash
        .as_deref()
        .unwrap_or("missing")
        .trim_start_matches("sha256:");
    let short_hash = &hash[..hash.len().min(12)];
    paths::cli_config_profile_default_dir(agent_name)
        .join(format!("{}-{short_hash}-{file_name}", now_nanos()))
}

fn ensure_default_backup_from_snapshot(
    agent_name: &str,
    mut target: CliConfigTargetFileManifest,
    snapshot: &TargetSnapshot,
    refresh_existing: bool,
) -> Result<CliConfigTargetFileManifest, String> {
    let backup_path = PathBuf::from(&target.default_backup_path);
    let is_new_target = target.last_applied_hash.is_none()
        && target.original_hash.is_none()
        && !target.default_was_missing
        && !backup_path.exists();

    if !refresh_existing && !is_new_target {
        if target.default_was_missing || backup_path.exists() {
            return Ok(target);
        }
        return Err(format!(
            "Default backup is missing for {}. Restore it before applying ORGII Managed again.",
            target.target_path
        ));
    }

    if snapshot.existed {
        let backup_path = versioned_default_backup_path(agent_name, &target, snapshot);
        write_sensitive_file_atomic(&backup_path, &snapshot.bytes)?;
        target.default_backup_path = backup_path.to_string_lossy().to_string();
        target.original_hash = snapshot.hash.clone();
        target.default_was_missing = false;
    } else {
        target.original_hash = None;
        target.default_was_missing = true;
    }

    Ok(target)
}

fn cleanup_transaction_dir(agent_name: &str) -> Result<(), String> {
    let dir = transaction_dir(agent_name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|err| format!("Failed to remove {}: {err}", dir.display()))?;
    }
    Ok(())
}

fn read_transaction_journal(
    agent_name: &str,
) -> Result<Option<CliConfigTransactionJournal>, String> {
    let path = transaction_journal_path(agent_name);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    let journal: CliConfigTransactionJournal = serde_json::from_str(&raw)
        .map_err(|err| format!("Invalid CLI config transaction {}: {err}", path.display()))?;
    if journal.agent != agent_name {
        return Err(format!(
            "CLI config transaction agent mismatch: expected {agent_name}, found {}",
            journal.agent
        ));
    }
    Ok(Some(journal))
}

fn rollback_transaction(journal: &CliConfigTransactionJournal) -> Result<(), String> {
    let mut errors = Vec::new();
    for target in &journal.target_files {
        let target_path = PathBuf::from(&target.target_path);
        let result = if target.target_existed {
            let rollback_path = PathBuf::from(&target.rollback_path);
            std::fs::read(&rollback_path)
                .map_err(|err| format!("Failed to read {}: {err}", rollback_path.display()))
                .and_then(|bytes| write_sensitive_file_atomic(&target_path, &bytes))
        } else if target_path.exists() {
            std::fs::remove_file(&target_path)
                .map_err(|err| format!("Failed to remove {}: {err}", target_path.display()))
        } else {
            Ok(())
        };
        if let Err(err) = result {
            errors.push(err);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn recover_pending_transaction_unlocked(agent_name: &str) -> Result<(), String> {
    let Some(journal) = read_transaction_journal(agent_name)? else {
        let dir = transaction_dir(agent_name);
        if dir.exists() {
            cleanup_transaction_dir(agent_name)?;
        }
        return Ok(());
    };

    if file_hash(&manifest_path(agent_name))? == Some(journal.final_manifest_hash.clone()) {
        cleanup_transaction_dir(agent_name)?;
        return Ok(());
    }

    rollback_transaction(&journal)?;
    cleanup_transaction_dir(agent_name)
}

fn begin_transaction(
    agent_name: &str,
    snapshots: &BTreeMap<String, TargetSnapshot>,
    final_manifest: &CliConfigProfileManifest,
) -> Result<CliConfigTransactionJournal, String> {
    recover_pending_transaction_unlocked(agent_name)?;
    let rollback_dir = transaction_dir(agent_name).join("rollback");
    std::fs::create_dir_all(&rollback_dir)
        .map_err(|err| format!("Failed to create {}: {err}", rollback_dir.display()))?;

    let mut target_files = Vec::new();
    for (index, snapshot) in snapshots.values().enumerate() {
        if file_hash(&snapshot.target_path)? != snapshot.hash {
            cleanup_transaction_dir(agent_name)?;
            return Err(format!(
                "CLI config changed while ORGII was preparing the switch: {}",
                snapshot.target_path.display()
            ));
        }

        let rollback_path = rollback_dir.join(format!("{index}-{}.bak", snapshot.id));
        if snapshot.existed {
            write_sensitive_file_atomic(&rollback_path, &snapshot.bytes)?;
        }
        target_files.push(CliConfigTransactionTarget {
            id: snapshot.id.clone(),
            target_path: snapshot.target_path.to_string_lossy().to_string(),
            rollback_path: rollback_path.to_string_lossy().to_string(),
            target_existed: snapshot.existed,
        });
    }

    let journal = CliConfigTransactionJournal {
        agent: agent_name.to_string(),
        final_manifest_hash: sha256_bytes(&manifest_bytes(final_manifest)?),
        target_files,
        created_at: now_stamp(),
    };
    let bytes = serde_json::to_vec_pretty(&journal)
        .map_err(|err| format!("Failed to serialize CLI config transaction: {err}"))?;
    write_sensitive_file_atomic(&transaction_journal_path(agent_name), &bytes)?;
    Ok(journal)
}

fn execute_transaction(
    agent_name: &str,
    snapshots: &BTreeMap<String, TargetSnapshot>,
    mutations: &BTreeMap<String, TargetMutation>,
    final_manifest: &CliConfigProfileManifest,
) -> Result<(), String> {
    let journal = begin_transaction(agent_name, snapshots, final_manifest)?;
    let result = (|| {
        for (id, mutation) in mutations {
            let snapshot = snapshots
                .get(id)
                .ok_or_else(|| format!("Missing CLI config snapshot for target {id}"))?;
            match mutation {
                TargetMutation::Write(bytes) => {
                    write_sensitive_file_atomic(&snapshot.target_path, bytes)?
                }
                TargetMutation::Remove => {
                    if snapshot.target_path.exists() {
                        std::fs::remove_file(&snapshot.target_path).map_err(|err| {
                            format!("Failed to remove {}: {err}", snapshot.target_path.display())
                        })?;
                    }
                }
            }
        }
        write_manifest(final_manifest)
    })();

    if let Err(operation_error) = result {
        let rollback_result = rollback_transaction(&journal);
        if rollback_result.is_ok() {
            let _ = cleanup_transaction_dir(agent_name);
            return Err(operation_error);
        }
        return Err(format!(
            "{operation_error}; rollback also failed: {}",
            rollback_result.unwrap_err()
        ));
    }

    if let Err(err) = cleanup_transaction_dir(agent_name) {
        tracing::warn!(agent = agent_name, error = %err, "Committed CLI config transaction left cleanup files");
    }
    Ok(())
}

fn status_for_unlocked(agent_name: &str) -> Result<CliConfigManagedStatus, String> {
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
    let fallback_targets = agent_manifest_targets(agent_name)?;
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
    let _guard = config_operation_guard()?;
    recover_pending_transaction_unlocked(agent_name)?;
    managed_selection_for_agent_unlocked(agent_name)
}

fn managed_selection_for_agent_unlocked(
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
        proxy_token: manifest.proxy_token,
    }))
}

fn proxy_route_base_url(
    proxy_url: &str,
    agent_name: &str,
    proxy_token: &str,
    suffix: &str,
) -> String {
    let root = proxy_url.trim().trim_end_matches('/');
    format!("{root}/cli/{agent_name}/{proxy_token}/{suffix}")
}

fn codex_proxy_base_url(proxy_url: &str, proxy_token: &str) -> String {
    proxy_route_base_url(proxy_url, CODEX_AGENT, proxy_token, "v1")
}

fn claude_code_proxy_base_url(proxy_url: &str, proxy_token: &str) -> String {
    proxy_route_base_url(proxy_url, CLAUDE_CODE_AGENT, proxy_token, "claude")
}

fn gemini_cli_proxy_base_url(proxy_url: &str, proxy_token: &str) -> String {
    proxy_route_base_url(proxy_url, GEMINI_CLI_AGENT, proxy_token, "gemini")
}

fn openai_chat_proxy_base_url(proxy_url: &str, agent_name: &str, proxy_token: &str) -> String {
    proxy_route_base_url(proxy_url, agent_name, proxy_token, "v1")
}

fn generate_codex_managed_config(
    existing_content: &str,
    selected_model: Option<&str>,
    proxy_url: &str,
    proxy_token: &str,
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
        toml::Value::String(codex_proxy_base_url(proxy_url, proxy_token)),
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
    proxy_token: &str,
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
        serde_json::Value::String(proxy_token.to_string()),
    );
    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        serde_json::Value::String(claude_code_proxy_base_url(proxy_url, proxy_token)),
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
    proxy_token: &str,
) -> String {
    let model = selected_model_or_default(selected_model).to_string();
    upsert_env_file(
        existing_content,
        &[
            ("GEMINI_API_KEY", proxy_token.to_string()),
            ("GOOGLE_API_KEY", proxy_token.to_string()),
            ("GEMINI_MODEL", model),
            (
                "GOOGLE_GEMINI_BASE_URL",
                gemini_cli_proxy_base_url(proxy_url, proxy_token),
            ),
        ],
    )
}

fn generate_opencode_managed_config(
    existing_content: &str,
    selected_model: Option<&str>,
    proxy_url: &str,
    proxy_token: &str,
) -> Result<String, String> {
    let mut config: serde_json::Value = if existing_content.trim().is_empty() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        json5::from_str(existing_content).map_err(|err| format!("Invalid OpenCode JSONC: {err}"))?
    };
    let Some(root) = config.as_object_mut() else {
        return Err("OpenCode config must be a JSON object".to_string());
    };

    if !matches!(root.get("provider"), Some(serde_json::Value::Object(_))) {
        root.insert(
            "provider".to_string(),
            serde_json::Value::Object(serde_json::Map::new()),
        );
    }
    let Some(serde_json::Value::Object(providers)) = root.get_mut("provider") else {
        return Err("Failed to build OpenCode provider object".to_string());
    };

    let model = selected_model_or_default(selected_model);
    let mut models = serde_json::Map::new();
    models.insert(model.to_string(), serde_json::json!({}));
    providers.insert(
        ORGII_PROVIDER_ID.to_string(),
        serde_json::json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": ORGII_PROVIDER_NAME,
            "options": {
                "baseURL": openai_chat_proxy_base_url(
                    proxy_url,
                    OPENCODE_AGENT,
                    proxy_token,
                ),
                "apiKey": proxy_token,
            },
            "models": models,
        }),
    );
    let model_ref = format!("{ORGII_PROVIDER_ID}/{model}");
    root.insert(
        "model".to_string(),
        serde_json::Value::String(model_ref.clone()),
    );
    root.insert(
        "small_model".to_string(),
        serde_json::Value::String(model_ref),
    );

    serde_json::to_string_pretty(&config)
        .map(|value| format!("{value}\n"))
        .map_err(|err| format!("OpenCode JSON serialize error: {err}"))
}

fn generate_aider_managed_config(
    existing_content: &str,
    selected_model: Option<&str>,
    proxy_url: &str,
    proxy_token: &str,
) -> Result<String, String> {
    let mut config: serde_yaml::Value = if existing_content.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        serde_yaml::from_str(existing_content)
            .map_err(|err| format!("Invalid Aider YAML: {err}"))?
    };
    let Some(root) = config.as_mapping_mut() else {
        return Err("Aider config must be a YAML mapping".to_string());
    };

    let model = selected_model_or_default(selected_model);
    let aider_model = if model.starts_with("openai/") {
        model.to_string()
    } else {
        format!("openai/{model}")
    };
    root.insert(
        serde_yaml::Value::String("model".to_string()),
        serde_yaml::Value::String(aider_model),
    );
    root.insert(
        serde_yaml::Value::String("openai-api-base".to_string()),
        serde_yaml::Value::String(openai_chat_proxy_base_url(
            proxy_url,
            AIDER_AGENT,
            proxy_token,
        )),
    );
    root.insert(
        serde_yaml::Value::String("openai-api-key".to_string()),
        serde_yaml::Value::String(proxy_token.to_string()),
    );

    serde_yaml::to_string(&config).map_err(|err| format!("Aider YAML serialize error: {err}"))
}

fn generate_managed_configs(
    agent_name: &str,
    existing_contents: &BTreeMap<String, String>,
    selected_model: Option<&str>,
    proxy_url: &str,
    proxy_token: &str,
) -> Result<BTreeMap<String, String>, String> {
    let adapter = managed_config_adapter(agent_name)
        .ok_or_else(|| format!("ORGII managed config is not available for {agent_name}"))?;
    let content = |file_id: &str| {
        existing_contents
            .get(file_id)
            .map(String::as_str)
            .unwrap_or("")
    };
    let mut files = BTreeMap::new();
    for target in adapter.targets {
        let existing_content = content(target.file_id);
        let generated = match target.generator {
            ManagedConfigGenerator::CodexToml => generate_codex_managed_config(
                existing_content,
                selected_model,
                proxy_url,
                proxy_token,
            )?,
            ManagedConfigGenerator::ClaudeCodeJson => generate_claude_code_managed_config(
                existing_content,
                selected_model,
                proxy_url,
                proxy_token,
            )?,
            ManagedConfigGenerator::GeminiSettingsJson => {
                generate_gemini_cli_settings_config(existing_content)?
            }
            ManagedConfigGenerator::GeminiEnv => generate_gemini_cli_env_config(
                existing_content,
                selected_model,
                proxy_url,
                proxy_token,
            ),
            ManagedConfigGenerator::OpenCodeJsonc => generate_opencode_managed_config(
                existing_content,
                selected_model,
                proxy_url,
                proxy_token,
            )?,
            ManagedConfigGenerator::AiderYaml => generate_aider_managed_config(
                existing_content,
                selected_model,
                proxy_url,
                proxy_token,
            )?,
        };
        files.insert(target.file_id.to_string(), generated);
    }
    Ok(files)
}

fn enable_agent_orgii_managed_unlocked(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    let fallback_targets = agent_manifest_targets(agent_name)?;
    let existing_manifest = read_manifest(agent_name)?;
    let targets = targets_with_fallbacks(existing_manifest.as_ref(), &fallback_targets);
    let snapshots = read_target_snapshots(&targets)?;
    let mut current_contents = BTreeMap::new();

    for target in &targets {
        let snapshot = snapshots
            .get(&target.id)
            .ok_or_else(|| format!("Missing CLI config snapshot for target {}", target.id))?;
        let content = String::from_utf8(snapshot.bytes.clone()).map_err(|err| {
            format!(
                "CLI config must be UTF-8 text ({}): {err}",
                snapshot.target_path.display()
            )
        })?;
        current_contents.insert(target.id.clone(), content);
    }

    if let Some(existing_manifest) = &existing_manifest {
        if existing_manifest.mode == CliConfigMode::OrgiiManaged && !force {
            for target in &existing_manifest.target_files {
                if let Some(last_hash) = &target.last_applied_hash {
                    let current_hash = snapshots
                        .get(&target.id)
                        .and_then(|snapshot| snapshot.hash.as_ref());
                    if current_hash != Some(last_hash) {
                        return Err(
                            "Current CLI config was modified outside ORGII. Restore or force apply before overwriting it."
                                .to_string(),
                        );
                    }
                }
            }
        }
    }

    let proxy_url = DEFAULT_PROXY_URL.to_string();
    let proxy_token = generate_proxy_token();
    let managed_contents = generate_managed_configs(
        agent_name,
        &current_contents,
        model.as_deref(),
        &proxy_url,
        &proxy_token,
    )?;

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
        proxy_token: None,
        created_at: now.clone(),
        updated_at: now.clone(),
    });

    let mut managed_targets = Vec::new();
    let mut mutations = BTreeMap::new();
    for target in targets {
        let Some(managed_content) = managed_contents.get(&target.id) else {
            continue;
        };
        let snapshot = snapshots
            .get(&target.id)
            .ok_or_else(|| format!("Missing CLI config snapshot for target {}", target.id))?;
        let mut target = ensure_default_backup_from_snapshot(
            agent_name,
            target,
            snapshot,
            refresh_default_backup,
        )?;
        let managed_hash = sha256_bytes(managed_content.as_bytes());

        let managed_path = PathBuf::from(&target.managed_profile_path);
        write_sensitive_file_atomic(&managed_path, managed_content.as_bytes())?;

        target.last_applied_hash = Some(managed_hash);
        mutations.insert(
            target.id.clone(),
            TargetMutation::Write(managed_content.as_bytes().to_vec()),
        );
        managed_targets.push(target);
    }

    manifest.mode = CliConfigMode::OrgiiManaged;
    manifest.target_files = managed_targets;
    manifest.selected_key_id = key_id;
    manifest.selected_provider = provider;
    manifest.selected_model = model;
    manifest.proxy_url = Some(proxy_url);
    manifest.proxy_token = Some(proxy_token);
    manifest.updated_at = now_stamp();
    execute_transaction(agent_name, &snapshots, &mutations, &manifest)?;
    status_for_unlocked(agent_name)
}

fn restore_agent_default_unlocked(
    agent_name: &str,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    let mut manifest = read_manifest(agent_name)?
        .ok_or_else(|| format!("No Default backup exists for {agent_name} yet"))?;
    if manifest.mode == CliConfigMode::Default {
        return status_for_unlocked(agent_name);
    }
    let snapshots = read_target_snapshots(&manifest.target_files)?;
    let mut mutations = BTreeMap::new();

    for target in &manifest.target_files {
        if manifest.mode == CliConfigMode::OrgiiManaged && !force {
            if let Some(last_hash) = &target.last_applied_hash {
                let current_hash = snapshots
                    .get(&target.id)
                    .and_then(|snapshot| snapshot.hash.as_ref());
                if current_hash != Some(last_hash) {
                    return Err(
                        "Current CLI config was modified outside ORGII. Force restore to overwrite it."
                            .to_string(),
                    );
                }
            }
        }

        if target.default_was_missing {
            mutations.insert(target.id.clone(), TargetMutation::Remove);
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
            if target.original_hash.as_ref() != Some(&sha256_bytes(&bytes)) {
                return Err(format!(
                    "Default backup hash mismatch: {}",
                    backup_path.display()
                ));
            }
            mutations.insert(target.id.clone(), TargetMutation::Write(bytes));
        }
    }

    manifest.mode = CliConfigMode::Default;
    manifest.updated_at = now_stamp();
    execute_transaction(agent_name, &snapshots, &mutations, &manifest)?;
    status_for_unlocked(agent_name)
}

pub fn enable_orgii_managed(
    agent_name: &str,
    key_id: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    force: bool,
) -> Result<CliConfigManagedStatus, String> {
    let _guard = config_operation_guard()?;
    recover_pending_transaction_unlocked(agent_name)?;
    if !supported_agent(agent_name) {
        return Err(format!(
            "ORGII managed config is not available for {agent_name} in this build"
        ));
    }
    enable_agent_orgii_managed_unlocked(agent_name, key_id, provider, model, force)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_config_get_status(agent_name: String) -> Result<CliConfigManagedStatus, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = config_operation_guard()?;
        recover_pending_transaction_unlocked(&agent_name)?;
        status_for_unlocked(&agent_name)
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
        let _guard = config_operation_guard()?;
        recover_pending_transaction_unlocked(&agent_name)?;
        if !supported_agent(&agent_name) {
            return Err(format!(
                "ORGII managed config is not available for {agent_name} in this build"
            ));
        }
        restore_agent_default_unlocked(&agent_name, force)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    const TEST_PROXY_TOKEN: &str = "test-proxy-token";
    static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    struct OrgiiHomeGuard {
        previous: Option<OsString>,
    }

    impl OrgiiHomeGuard {
        fn set(path: &Path) -> Self {
            let previous = std::env::var_os("ORGII_HOME");
            std::env::set_var("ORGII_HOME", path);
            Self { previous }
        }
    }

    impl Drop for OrgiiHomeGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("ORGII_HOME", value),
                None => std::env::remove_var("ORGII_HOME"),
            }
        }
    }

    fn test_target(
        id: &str,
        target_path: &Path,
        profile_root: &Path,
    ) -> CliConfigTargetFileManifest {
        CliConfigTargetFileManifest {
            id: id.to_string(),
            target_path: target_path.to_string_lossy().to_string(),
            default_backup_path: profile_root
                .join("default")
                .join(format!("{id}.bak"))
                .to_string_lossy()
                .to_string(),
            managed_profile_path: profile_root
                .join("managed")
                .join(format!("{id}.txt"))
                .to_string_lossy()
                .to_string(),
            original_hash: None,
            last_applied_hash: None,
            default_was_missing: false,
        }
    }

    fn test_manifest(
        agent_name: &str,
        targets: Vec<CliConfigTargetFileManifest>,
    ) -> CliConfigProfileManifest {
        CliConfigProfileManifest {
            agent: agent_name.to_string(),
            mode: CliConfigMode::OrgiiManaged,
            target_files: targets,
            selected_key_id: Some("key-1".to_string()),
            selected_provider: Some("openai_api".to_string()),
            selected_model: Some("gpt-test".to_string()),
            proxy_url: Some(DEFAULT_PROXY_URL.to_string()),
            proxy_token: Some(TEST_PROXY_TOKEN.to_string()),
            created_at: "1".to_string(),
            updated_at: "1".to_string(),
        }
    }

    #[test]
    fn codex_managed_config_preserves_existing_settings() {
        let raw = r#"
model = "gpt-5"
approval_policy = "on-request"

[features]
shell_tool = true
"#;

        let generated = generate_codex_managed_config(
            raw,
            Some("gpt-5-codex"),
            DEFAULT_PROXY_URL,
            TEST_PROXY_TOKEN,
        )
        .unwrap();
        let parsed: toml::Value = toml::from_str(&generated).unwrap();

        assert_eq!(parsed["model"].as_str(), Some("gpt-5-codex"));
        assert_eq!(parsed["model_provider"].as_str(), Some("orgii"));
        assert_eq!(parsed["approval_policy"].as_str(), Some("on-request"));
        assert_eq!(parsed["features"]["shell_tool"].as_bool(), Some(true));
        assert_eq!(
            parsed["model_providers"]["orgii"]["base_url"].as_str(),
            Some("http://127.0.0.1:17888/cli/codex/test-proxy-token/v1")
        );
        assert!(parsed["model_providers"]["orgii"].get("env_key").is_none());
        assert_eq!(
            parsed["model_providers"]["orgii"]["requires_openai_auth"].as_bool(),
            Some(false)
        );
    }

    #[test]
    fn codex_managed_config_uses_placeholder_model_when_missing() {
        let generated =
            generate_codex_managed_config("", None, "http://localhost:9999", TEST_PROXY_TOKEN)
                .unwrap();
        let parsed: toml::Value = toml::from_str(&generated).unwrap();

        assert_eq!(parsed["model"].as_str(), Some(DEFAULT_ORGII_MODEL));
        assert_eq!(
            parsed["model_providers"]["orgii"]["base_url"].as_str(),
            Some("http://localhost:9999/cli/codex/test-proxy-token/v1")
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

        let generated = generate_claude_code_managed_config(
            raw,
            Some("claude-sonnet-4-5"),
            DEFAULT_PROXY_URL,
            TEST_PROXY_TOKEN,
        )
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
            Some("http://127.0.0.1:17888/cli/claude_code/test-proxy-token/claude")
        );
        assert_eq!(
            parsed["env"]["ANTHROPIC_AUTH_TOKEN"].as_str(),
            Some(TEST_PROXY_TOKEN)
        );
        assert_eq!(
            parsed["env"]["ANTHROPIC_MODEL"].as_str(),
            Some("claude-sonnet-4-5")
        );
    }

    #[test]
    fn proxy_base_urls_include_authenticated_route() {
        assert_eq!(
            codex_proxy_base_url(DEFAULT_PROXY_URL, TEST_PROXY_TOKEN),
            "http://127.0.0.1:17888/cli/codex/test-proxy-token/v1"
        );
        assert_eq!(
            claude_code_proxy_base_url(DEFAULT_PROXY_URL, TEST_PROXY_TOKEN),
            "http://127.0.0.1:17888/cli/claude_code/test-proxy-token/claude"
        );
        assert_eq!(
            gemini_cli_proxy_base_url(DEFAULT_PROXY_URL, TEST_PROXY_TOKEN),
            "http://127.0.0.1:17888/cli/gemini_cli/test-proxy-token/gemini"
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
        existing.insert(
            GEMINI_CLI_SETTINGS_FILE_ID.to_string(),
            settings.to_string(),
        );
        existing.insert(GEMINI_CLI_ENV_FILE_ID.to_string(), env.to_string());

        let generated = generate_managed_configs(
            GEMINI_CLI_AGENT,
            &existing,
            Some("gemini-2.5-pro"),
            DEFAULT_PROXY_URL,
            TEST_PROXY_TOKEN,
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
        assert!(generated_env.contains("GEMINI_API_KEY=\"test-proxy-token\""));
        assert!(generated_env.contains("GOOGLE_API_KEY=\"test-proxy-token\""));
        assert!(generated_env.contains("GEMINI_MODEL=\"gemini-2.5-pro\""));
        assert!(generated_env.contains(
            "GOOGLE_GEMINI_BASE_URL=\"http://127.0.0.1:17888/cli/gemini_cli/test-proxy-token/gemini\""
        ));
        assert!(!generated_env.contains("old-key"));
        assert!(!generated_env.contains("https://old.example.com"));
    }

    #[test]
    fn gemini_cli_manifest_tracks_settings_and_env() {
        let targets = agent_manifest_targets(GEMINI_CLI_AGENT).unwrap();
        let ids: Vec<_> = targets.iter().map(|target| target.id.as_str()).collect();

        assert_eq!(
            ids,
            vec![GEMINI_CLI_SETTINGS_FILE_ID, GEMINI_CLI_ENV_FILE_ID]
        );
    }

    #[test]
    fn managed_adapter_registry_exposes_protocols_and_targets() {
        assert_eq!(
            managed_proxy_protocol_for_agent(CODEX_AGENT),
            Some(CliManagedProxyProtocol::OpenAiResponses)
        );
        assert_eq!(
            managed_proxy_protocol_for_agent(OPENCODE_AGENT),
            Some(CliManagedProxyProtocol::OpenAiChatCompletions)
        );
        assert_eq!(
            managed_proxy_protocol_for_agent(AIDER_AGENT),
            Some(CliManagedProxyProtocol::OpenAiChatCompletions)
        );
        assert!(!supported_agent("amp"));

        let opencode_targets = agent_manifest_targets(OPENCODE_AGENT).unwrap();
        assert_eq!(opencode_targets.len(), 1);
        assert_eq!(opencode_targets[0].id, OPENCODE_CONFIG_FILE_ID);
        let aider_targets = agent_manifest_targets(AIDER_AGENT).unwrap();
        assert_eq!(aider_targets.len(), 1);
        assert_eq!(aider_targets[0].id, AIDER_CONFIG_FILE_ID);
    }

    #[test]
    fn opencode_managed_config_preserves_jsonc_and_adds_orgii_provider() {
        let raw = r#"
{
  // Keep existing providers and settings.
  "theme": "system",
  "provider": {
    "existing": {
      "npm": "@ai-sdk/openai"
    },
  },
}
"#;

        let generated = generate_opencode_managed_config(
            raw,
            Some("deepseek-chat"),
            DEFAULT_PROXY_URL,
            TEST_PROXY_TOKEN,
        )
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&generated).unwrap();

        assert_eq!(parsed["theme"].as_str(), Some("system"));
        assert!(parsed["provider"]["existing"].is_object());
        assert_eq!(
            parsed["provider"]["orgii"]["options"]["baseURL"].as_str(),
            Some("http://127.0.0.1:17888/cli/opencode/test-proxy-token/v1")
        );
        assert_eq!(
            parsed["provider"]["orgii"]["options"]["apiKey"].as_str(),
            Some(TEST_PROXY_TOKEN)
        );
        assert_eq!(parsed["model"].as_str(), Some("orgii/deepseek-chat"));
        assert_eq!(parsed["small_model"].as_str(), Some("orgii/deepseek-chat"));
    }

    #[test]
    fn aider_managed_config_preserves_yaml_and_uses_openai_compatible_model() {
        let raw = r#"
auto-commits: false
map-tokens: 2048
"#;

        let generated = generate_aider_managed_config(
            raw,
            Some("anthropic/claude-sonnet-4"),
            DEFAULT_PROXY_URL,
            TEST_PROXY_TOKEN,
        )
        .unwrap();
        let parsed: serde_yaml::Value = serde_yaml::from_str(&generated).unwrap();

        assert_eq!(parsed["auto-commits"].as_bool(), Some(false));
        assert_eq!(parsed["map-tokens"].as_u64(), Some(2048));
        assert_eq!(
            parsed["model"].as_str(),
            Some("openai/anthropic/claude-sonnet-4")
        );
        assert_eq!(
            parsed["openai-api-base"].as_str(),
            Some("http://127.0.0.1:17888/cli/aider/test-proxy-token/v1")
        );
        assert_eq!(parsed["openai-api-key"].as_str(), Some(TEST_PROXY_TOKEN));
    }

    #[test]
    fn generated_proxy_token_has_256_bits() {
        let token = generate_proxy_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn atomic_write_replaces_existing_file_without_delete_gap() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("config.json");
        std::fs::write(&path, b"old").unwrap();

        write_file_atomic(&path, b"new").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn transaction_rolls_back_prior_targets_when_later_write_fails() {
        let _env_lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii-home"));
        let target_a_path = temp.path().join("a.json");
        let blocked_parent = temp.path().join("blocked-parent");
        let target_b_path = blocked_parent.join("b.json");
        std::fs::write(&target_a_path, b"original-a").unwrap();
        std::fs::write(&blocked_parent, b"not-a-directory").unwrap();

        let profile_root = temp.path().join("profiles");
        let target_a = test_target("a", &target_a_path, &profile_root);
        let target_b = test_target("b", &target_b_path, &profile_root);
        let targets = vec![target_a.clone(), target_b.clone()];
        let snapshots = read_target_snapshots(&targets).unwrap();
        let manifest = test_manifest("test-agent", targets);
        let mutations = BTreeMap::from([
            (
                "a".to_string(),
                TargetMutation::Write(b"managed-a".to_vec()),
            ),
            (
                "b".to_string(),
                TargetMutation::Write(b"managed-b".to_vec()),
            ),
        ]);

        let result = execute_transaction("test-agent", &snapshots, &mutations, &manifest);

        assert!(result.is_err());
        assert_eq!(std::fs::read(&target_a_path).unwrap(), b"original-a");
        assert!(!target_b_path.exists());
        assert!(!transaction_journal_path("test-agent").exists());
    }

    #[test]
    fn pending_transaction_recovers_exact_pre_operation_content() {
        let _env_lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii-home"));
        let target_path = temp.path().join("config.toml");
        std::fs::write(&target_path, b"original").unwrap();
        let target = test_target("config", &target_path, &temp.path().join("profiles"));
        let snapshots = read_target_snapshots(std::slice::from_ref(&target)).unwrap();
        let manifest = test_manifest("test-agent", vec![target]);

        begin_transaction("test-agent", &snapshots, &manifest).unwrap();
        write_file_atomic(&target_path, b"managed").unwrap();
        recover_pending_transaction_unlocked("test-agent").unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"original");
        assert!(!transaction_journal_path("test-agent").exists());
    }

    #[test]
    fn committed_transaction_cleanup_does_not_undo_target_changes() {
        let _env_lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii-home"));
        let target_path = temp.path().join("config.toml");
        std::fs::write(&target_path, b"original").unwrap();
        let target = test_target("config", &target_path, &temp.path().join("profiles"));
        let snapshots = read_target_snapshots(std::slice::from_ref(&target)).unwrap();
        let manifest = test_manifest("test-agent", vec![target]);

        begin_transaction("test-agent", &snapshots, &manifest).unwrap();
        write_file_atomic(&target_path, b"managed").unwrap();
        write_manifest(&manifest).unwrap();
        recover_pending_transaction_unlocked("test-agent").unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"managed");
        assert!(!transaction_journal_path("test-agent").exists());
    }

    #[test]
    fn refreshed_default_backups_are_versioned_and_never_overwritten() {
        let _env_lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii-home"));
        let target_path = temp.path().join("config.toml");
        let profile_root = temp.path().join("profiles");
        let target = test_target("config", &target_path, &profile_root);

        std::fs::write(&target_path, b"default-v1").unwrap();
        let snapshots = read_target_snapshots(std::slice::from_ref(&target)).unwrap();
        let first = ensure_default_backup_from_snapshot(
            "test-agent",
            target,
            snapshots.get("config").unwrap(),
            true,
        )
        .unwrap();

        std::fs::write(&target_path, b"default-v2").unwrap();
        let snapshots = read_target_snapshots(std::slice::from_ref(&first)).unwrap();
        let second = ensure_default_backup_from_snapshot(
            "test-agent",
            first.clone(),
            snapshots.get("config").unwrap(),
            true,
        )
        .unwrap();

        assert_ne!(first.default_backup_path, second.default_backup_path);
        assert_eq!(
            std::fs::read(&first.default_backup_path).unwrap(),
            b"default-v1"
        );
        assert_eq!(
            std::fs::read(&second.default_backup_path).unwrap(),
            b"default-v2"
        );
    }

    #[test]
    fn restore_is_a_noop_when_default_mode_is_already_active() {
        let _env_lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii-home"));
        let target_path = temp.path().join("config.toml");
        let profile_root = temp.path().join("profiles");
        let mut target = test_target("config", &target_path, &profile_root);
        let backup_path = PathBuf::from(&target.default_backup_path);
        std::fs::create_dir_all(backup_path.parent().unwrap()).unwrap();
        std::fs::write(&backup_path, b"older-default").unwrap();
        std::fs::write(&target_path, b"new-user-change").unwrap();
        target.original_hash = Some(sha256_bytes(b"older-default"));
        target.last_applied_hash = Some(sha256_bytes(b"managed"));

        let mut manifest = test_manifest(CODEX_AGENT, vec![target]);
        manifest.mode = CliConfigMode::Default;
        write_manifest(&manifest).unwrap();

        restore_agent_default_unlocked(CODEX_AGENT, false).unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"new-user-change");
    }

    #[test]
    fn missing_managed_mode_backup_is_never_recreated_from_active_config() {
        let temp = tempfile::tempdir().unwrap();
        let target_path = temp.path().join("config.toml");
        std::fs::write(&target_path, b"managed-content").unwrap();
        let mut target = test_target("config", &target_path, &temp.path().join("profiles"));
        target.original_hash = Some(sha256_bytes(b"original-content"));
        target.last_applied_hash = Some(sha256_bytes(b"managed-content"));
        let snapshots = read_target_snapshots(std::slice::from_ref(&target)).unwrap();

        let result = ensure_default_backup_from_snapshot(
            "test-agent",
            target,
            snapshots.get("config").unwrap(),
            false,
        );

        assert!(result.is_err());
    }
}
