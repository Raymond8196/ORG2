//! Loader plugins.
//!
//! A plugin is a directory containing a `plugin.toml`. Two loader kinds:
//!
//! - `format = "anthropic-jsonl"` — a *no-code* source over `orgtrack_core`'s
//!   generic JSONL reader. The manifest supplies identity + root directories;
//!   it only reads files, so it needs no trust.
//! - `format = "exec"` — an executable that speaks a small JSON protocol over
//!   stdin/stdout (any language). Because it runs arbitrary code it is **inert
//!   until trusted**: `orgtrack plugins trust <id>` pins a content hash of the
//!   manifest + the executable; any later change re-arms the prompt.
//!
//! Discovery is user-scoped (`~/.orgtrack/plugins`) plus an explicit
//! `$ORGTRACK_PLUGIN_PATH`. Project-scoped plugins (`./.orgtrack/plugins`) are
//! intentionally NOT auto-loaded — running code from a cloned repo is a
//! supply-chain risk.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use orgtrack_core::sources::anthropic_jsonl::AnthropicJsonlSource;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// How a loader plugin produces sessions.
pub enum LoaderImpl {
    /// No-code reader over the generic Anthropic JSONL loader.
    Jsonl(AnthropicJsonlSource),
    /// An executable speaking the plugin JSON protocol.
    Exec(ExecSpec),
}

#[derive(Clone)]
pub struct ExecSpec {
    /// Absolute path to the executable (manifest-relative paths are resolved).
    pub exec_path: PathBuf,
    /// Working directory for the child (the manifest dir).
    pub cwd: PathBuf,
    /// Wire protocol version the plugin declares.
    pub protocol: u32,
    pub parser_version: i64,
}

/// Whether an exec plugin is allowed to run.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Trust {
    /// No trust needed (declarative, code-free).
    NotRequired,
    /// Exec plugin whose content hash matches the trust store.
    Trusted,
    /// Exec plugin not yet trusted, or changed since it was trusted.
    Untrusted,
}

/// A validated loader plugin.
pub struct LoaderPlugin {
    pub id: &'static str,
    pub label: &'static str,
    pub session_prefix: &'static str,
    pub imp: LoaderImpl,
    pub trust: Trust,
    pub manifest_dir: PathBuf,
}

impl LoaderPlugin {
    /// Whether this plugin is allowed to run (declarative always; exec only
    /// when trusted).
    pub fn runnable(&self) -> bool {
        !matches!(self.trust, Trust::Untrusted)
    }

    pub fn kind_label(&self) -> &'static str {
        match self.imp {
            LoaderImpl::Jsonl(_) => "loader (jsonl)",
            LoaderImpl::Exec(_) => "loader (exec)",
        }
    }
}

/// A plugin directory that failed to load, kept so `plugins list` can surface
/// the reason instead of silently dropping it.
pub struct BrokenPlugin {
    pub dir: PathBuf,
    pub error: String,
}

#[derive(Default)]
pub struct Discovered {
    pub loaders: Vec<LoaderPlugin>,
    pub broken: Vec<BrokenPlugin>,
}

#[derive(Deserialize)]
struct Manifest {
    plugin: PluginMeta,
    loader: Option<LoaderSpec>,
}

#[derive(Deserialize)]
struct PluginMeta {
    id: String,
    #[serde(default)]
    label: String,
    kind: String,
    #[serde(default)]
    format: String,
    #[serde(default)]
    exec: String,
    #[serde(default = "default_protocol")]
    protocol: u32,
}

#[derive(Deserialize)]
struct LoaderSpec {
    #[serde(default)]
    session_prefix: String,
    #[serde(default = "default_parser_version")]
    parser_version: i64,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    exclude_subagent_dirs: bool,
}

fn default_parser_version() -> i64 {
    1
}
fn default_protocol() -> u32 {
    1
}

/// The wire protocol version this build implements.
pub const PROTOCOL_VERSION: u32 = 1;

/// Discover every plugin under the search path. `enabled = false` skips
/// discovery entirely (the `--no-plugins` escape hatch).
pub fn discover(enabled: bool) -> Discovered {
    let mut found = Discovered::default();
    if !enabled {
        return found;
    }
    let trust_store = load_trust_store();
    for dir in plugin_dirs() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let manifest_path = entry.path().join("plugin.toml");
            if !manifest_path.is_file() {
                continue;
            }
            match load_manifest(&manifest_path, &trust_store) {
                Ok(plugin) => {
                    if found.loaders.iter().any(|existing| existing.id == plugin.id) {
                        found.broken.push(BrokenPlugin {
                            dir: entry.path(),
                            error: format!("duplicate plugin id '{}'", plugin.id),
                        });
                    } else {
                        found.loaders.push(plugin);
                    }
                }
                Err(error) => found.broken.push(BrokenPlugin {
                    dir: entry.path(),
                    error,
                }),
            }
        }
    }
    found
}

/// Search path, highest precedence first: `$ORGTRACK_PLUGIN_PATH` (colon-sep)
/// then `~/.orgtrack/plugins`.
fn plugin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(path) = std::env::var("ORGTRACK_PLUGIN_PATH") {
        for part in path.split(':').filter(|part| !part.is_empty()) {
            dirs.push(PathBuf::from(expand_path(part)));
        }
    }
    if let Some(home) = home_dir() {
        dirs.push(home.join(".orgtrack/plugins"));
    }
    dirs
}

fn load_manifest(path: &Path, trust_store: &BTreeMap<String, String>) -> Result<LoaderPlugin, String> {
    let raw = std::fs::read_to_string(path).map_err(|err| format!("read: {err}"))?;
    let manifest: Manifest = toml::from_str(&raw).map_err(|err| format!("parse: {err}"))?;
    let manifest_dir = path.parent().unwrap_or(path).to_path_buf();

    let id = manifest.plugin.id.trim().to_string();
    if !is_valid_id(&id) {
        return Err(format!(
            "invalid plugin id '{id}' (use lowercase letters, digits, '_')"
        ));
    }
    if manifest.plugin.kind != "loader" {
        return Err(format!(
            "unsupported plugin kind '{}' (only 'loader' today)",
            manifest.plugin.kind
        ));
    }
    let label = if manifest.plugin.label.trim().is_empty() {
        id.clone()
    } else {
        manifest.plugin.label.trim().to_string()
    };
    let spec = manifest
        .loader
        .ok_or_else(|| "missing [loader] section".to_string())?;
    let session_prefix = spec.session_prefix.trim().to_string();
    if session_prefix.is_empty() {
        return Err("[loader].session_prefix must not be empty".to_string());
    }

    // Intern identity strings for the process lifetime (core holds
    // `&'static str`; the plugin set per run is small and bounded).
    let id_static: &'static str = leak(id.clone());
    let label_static: &'static str = leak(label);
    let prefix_static: &'static str = leak(session_prefix);

    let (imp, trust) = match manifest.plugin.format.as_str() {
        "anthropic-jsonl" => {
            let roots: Vec<PathBuf> = spec
                .roots
                .iter()
                .map(|root| PathBuf::from(expand_path(root)))
                .collect();
            if roots.is_empty() {
                return Err("[loader].roots must list at least one directory".to_string());
            }
            let config = AnthropicJsonlSource {
                source: id_static,
                session_prefix: prefix_static,
                provider_slug: id_static,
                display_name: label_static,
                parser_version: spec.parser_version,
                candidate_roots: roots,
                exclude_subagent_dirs: spec.exclude_subagent_dirs,
            };
            (LoaderImpl::Jsonl(config), Trust::NotRequired)
        }
        "exec" => {
            if manifest.plugin.protocol > PROTOCOL_VERSION {
                return Err(format!(
                    "plugin protocol {} is newer than supported {}",
                    manifest.plugin.protocol, PROTOCOL_VERSION
                ));
            }
            let exec_raw = manifest.plugin.exec.trim();
            if exec_raw.is_empty() {
                return Err("exec plugin needs `exec = \"…\"` in [plugin]".to_string());
            }
            let exec_path = resolve_exec(&manifest_dir, exec_raw);
            if !exec_path.is_file() {
                return Err(format!("exec not found: {}", exec_path.display()));
            }
            let hash = content_hash(path, &exec_path)?;
            let trust = if trust_store.get(&id).is_some_and(|stored| *stored == hash) {
                Trust::Trusted
            } else {
                Trust::Untrusted
            };
            (
                LoaderImpl::Exec(ExecSpec {
                    exec_path,
                    cwd: manifest_dir.clone(),
                    protocol: manifest.plugin.protocol,
                    parser_version: spec.parser_version,
                }),
                trust,
            )
        }
        other => {
            return Err(format!(
                "unsupported loader format '{other}' (expected 'anthropic-jsonl' or 'exec')"
            ))
        }
    };

    Ok(LoaderPlugin {
        id: id_static,
        label: label_static,
        session_prefix: prefix_static,
        imp,
        trust,
        manifest_dir,
    })
}

fn resolve_exec(manifest_dir: &Path, raw: &str) -> PathBuf {
    let expanded = expand_path(raw);
    let candidate = PathBuf::from(&expanded);
    if candidate.is_absolute() {
        candidate
    } else {
        manifest_dir.join(candidate)
    }
}

// ---------------------------------------------------------------------------
// Trust store
// ---------------------------------------------------------------------------

fn trust_store_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".orgtrack/trust.json"))
}

fn load_trust_store() -> BTreeMap<String, String> {
    let Some(path) = trust_store_path() else {
        return BTreeMap::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Pin trust for one plugin id by recording its current content hash. Only
/// exec plugins carry a hash; declarative plugins are a no-op with a clear
/// message.
pub fn trust(id: &str, discovered: &Discovered) -> Result<String, String> {
    let plugin = discovered
        .loaders
        .iter()
        .find(|plugin| plugin.id == id)
        .ok_or_else(|| format!("no plugin with id '{id}' (see `orgtrack plugins list`)"))?;
    let LoaderImpl::Exec(_) = &plugin.imp else {
        return Err(format!(
            "'{id}' is a declarative loader — it runs no code and needs no trust"
        ));
    };
    let manifest_path = plugin.manifest_dir.join("plugin.toml");
    let exec_path = match &plugin.imp {
        LoaderImpl::Exec(spec) => spec.exec_path.clone(),
        LoaderImpl::Jsonl(_) => unreachable!(),
    };
    let hash = content_hash(&manifest_path, &exec_path)?;

    let mut store = load_trust_store();
    store.insert(id.to_string(), hash.clone());
    let path = trust_store_path().ok_or_else(|| "cannot resolve HOME for trust store".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("create {}: {err}", parent.display()))?;
    }
    let serialized = serde_json::to_string_pretty(&store).map_err(|err| err.to_string())?;
    std::fs::write(&path, serialized).map_err(|err| format!("write {}: {err}", path.display()))?;
    Ok(hash)
}

/// sha256 over the manifest bytes then the executable bytes — any edit to
/// either re-arms trust.
fn content_hash(manifest_path: &Path, exec_path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let manifest = std::fs::read(manifest_path).map_err(|err| format!("read manifest: {err}"))?;
    hasher.update(&manifest);
    let exec = std::fs::read(exec_path).map_err(|err| format!("read exec: {err}"))?;
    hasher.update(&exec);
    Ok(format!("{:x}", hasher.finalize()))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}

/// Expand a leading `~` and any `${VAR}` occurrences in a path string.
fn expand_path(raw: &str) -> String {
    let mut expanded = raw.to_string();
    if let Some(rest) = expanded.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            expanded = home.join(rest).to_string_lossy().into_owned();
        }
    } else if expanded == "~" {
        if let Some(home) = home_dir() {
            expanded = home.to_string_lossy().into_owned();
        }
    }
    while let Some(start) = expanded.find("${") {
        let Some(end) = expanded[start..].find('}').map(|offset| start + offset) else {
            break;
        };
        let var = &expanded[start + 2..end];
        let value = std::env::var(var).unwrap_or_default();
        expanded.replace_range(start..=end, &value);
    }
    expanded
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn leak(value: String) -> &'static str {
    Box::leak(value.into_boxed_str())
}
