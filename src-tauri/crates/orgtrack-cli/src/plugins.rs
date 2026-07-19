//! Declarative loader plugins.
//!
//! A plugin is a directory containing a `plugin.toml`. Today one kind is
//! supported: `kind = "loader"`, `format = "anthropic-jsonl"` — a *no-code*
//! source that reuses `orgtrack_core`'s generic Anthropic/Claude-style JSONL
//! reader. The manifest supplies the identity + the root directories to scan;
//! everything downstream (`list` / `search` / `usage` / `show`) works because
//! the plugin produces the exact same normalized rows as a built-in loader.
//!
//! Discovery is user-scoped by default (`~/.orgtrack/plugins`) plus an explicit
//! `$ORGTRACK_PLUGIN_PATH`. Project-scoped plugins (`./.orgtrack/plugins`) are
//! intentionally NOT auto-loaded — running code/paths from a cloned repo is a
//! supply-chain risk that a later trust model will gate. Declarative loaders
//! only *read files*, but we still keep the discovery surface conservative.

use std::path::{Path, PathBuf};

use orgtrack_core::sources::anthropic_jsonl::AnthropicJsonlSource;
use serde::Deserialize;

/// A validated, ready-to-scan loader plugin.
pub struct LoaderPlugin {
    pub id: &'static str,
    pub label: &'static str,
    pub session_prefix: &'static str,
    pub config: AnthropicJsonlSource,
    /// Where the manifest was found (for `plugins list`).
    pub manifest_dir: PathBuf,
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
}

#[derive(Deserialize)]
struct LoaderSpec {
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

/// Discover every plugin under the search path. `enabled = false` skips
/// discovery entirely (the `--no-plugins` escape hatch).
pub fn discover(enabled: bool) -> Discovered {
    let mut found = Discovered::default();
    if !enabled {
        return found;
    }
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
            match load_manifest(&manifest_path) {
                Ok(plugin) => {
                    // First id wins (search-path precedence); later duplicates
                    // are reported as broken so collisions are visible.
                    if found.loaders.iter().any(|existing| existing.id == plugin.id)
                        || found.broken.iter().any(|b| b.dir == entry.path())
                    {
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

fn load_manifest(path: &Path) -> Result<LoaderPlugin, String> {
    let raw = std::fs::read_to_string(path).map_err(|err| format!("read: {err}"))?;
    let manifest: Manifest = toml::from_str(&raw).map_err(|err| format!("parse: {err}"))?;

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
    if manifest.plugin.format != "anthropic-jsonl" {
        return Err(format!(
            "unsupported loader format '{}' (only 'anthropic-jsonl' today)",
            manifest.plugin.format
        ));
    }
    let spec = manifest
        .loader
        .ok_or_else(|| "missing [loader] section".to_string())?;

    let session_prefix = spec.session_prefix.trim().to_string();
    if session_prefix.is_empty() {
        return Err("[loader].session_prefix must not be empty".to_string());
    }
    let roots: Vec<PathBuf> = spec
        .roots
        .iter()
        .map(|root| PathBuf::from(expand_path(root)))
        .collect();
    if roots.is_empty() {
        return Err("[loader].roots must list at least one directory".to_string());
    }

    let label = if manifest.plugin.label.trim().is_empty() {
        id.clone()
    } else {
        manifest.plugin.label.trim().to_string()
    };

    // Intern the identity strings for the process lifetime: the core config
    // holds `&'static str` (built-in sources are static), and the set of
    // plugin ids per run is small and bounded, so leaking is acceptable.
    let id_static: &'static str = leak(id);
    let label_static: &'static str = leak(label);
    let prefix_static: &'static str = leak(session_prefix);
    let slug_static: &'static str = id_static;

    Ok(LoaderPlugin {
        id: id_static,
        label: label_static,
        session_prefix: prefix_static,
        config: AnthropicJsonlSource {
            source: id_static,
            session_prefix: prefix_static,
            provider_slug: slug_static,
            display_name: label_static,
            parser_version: spec.parser_version,
            candidate_roots: roots,
            exclude_subagent_dirs: spec.exclude_subagent_dirs,
        },
        manifest_dir: path.parent().unwrap_or(path).to_path_buf(),
    })
}

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
