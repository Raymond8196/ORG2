use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use core_types::activity::ActivityChunk;
use rusqlite::Connection;
use serde::Deserialize;

use crate::sources::imported_history::{
    self, cache as imported_cache,
    metadata::{ImportedHistoryDiscoveredRecord, SOURCE_CODEX_APP},
    paths as imported_paths,
};

use super::*;

#[derive(Debug, Clone)]
pub(crate) struct CodexSessionIndexEntry {
    thread_name: String,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexSessionIndexLine {
    #[serde(default)]
    id: String,
    #[serde(default)]
    thread_name: String,
    #[serde(default)]
    updated_at: Option<String>,
}

pub fn list_codex_app_sessions_paginated(
    conn: &mut Connection,
    limit: usize,
    offset: usize,
) -> Result<CodexAppSessionPage, String> {
    sync_codex_app_cache(conn)?;
    imported_cache::query_imported_session_page_from_conn(conn, SOURCE_CODEX_APP, limit, offset)
}

pub fn list_codex_app_recent_paths(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<CodexAppRecentPath>, String> {
    sync_codex_app_cache(conn)?;
    imported_cache::query_imported_recent_paths_from_conn(conn, SOURCE_CODEX_APP, limit)
}

pub fn load_codex_app_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    load_codex_app_from_path(session_id, &path)
}

pub(crate) fn sync_codex_app_cache(conn: &mut Connection) -> Result<(), String> {
    let mut discovered = discover_codex_app_records()?;
    // Managed (GUI-launched) Codex sessions surface through their
    // code_sessions row (`cli_agent_type = 'codex'`); the imported twin goes
    // unlistable. Same pattern as the OpenCode/Claude readers.
    let managed_ids =
        crate::sources::imported_history::managed_mirror::managed_source_session_ids_from_conn(
            conn,
            "codex",
            SOURCE_CODEX_APP,
        )?;
    for record in &mut discovered {
        crate::sources::imported_history::managed_mirror::append_managed_fingerprint(
            &mut record.source_fingerprint,
            // Suffix match: the imported key is the rollout stem while the
            // runner binds the bare thread uuid.
            crate::sources::imported_history::managed_mirror::is_managed_source_session_id(
                &managed_ids,
                &record.source_session_id,
            ),
        );
    }
    let signatures = discovered
        .iter()
        .map(ImportedHistoryDiscoveredRecord::signature)
        .collect::<Vec<_>>();
    let changed =
        imported_cache::changed_records_from_conn(conn, SOURCE_CODEX_APP, &discovered, |record| {
            record.signature()
        })?;
    let mut inputs = Vec::new();
    let mut rounds = Vec::new();
    let mut reparsed_ids = Vec::new();
    for record in changed {
        if let Some(mut meta) = parse_codex_session_meta(record)? {
            let is_managed_history_mirror =
                crate::sources::imported_history::managed_mirror::is_managed_source_session_id(
                    &managed_ids,
                    &meta.source_session_id,
                );
            reparsed_ids.push(meta.session_id.clone());
            rounds.append(&mut meta.rounds);
            let mut input = session_meta_to_cache_input(meta);
            input.listable = input.listable && !is_managed_history_mirror;
            inputs.push(input);
        }
    }
    imported_cache::sync_source_cache_from_conn(
        conn,
        SOURCE_CODEX_APP,
        imported_cache::live_ids_from_signatures(&signatures),
        inputs,
    )?;
    imported_cache::write_session_rounds_from_conn(conn, &reparsed_ids, &rounds)
}

pub(crate) fn discover_codex_app_records() -> Result<Vec<ImportedHistoryDiscoveredRecord>, String> {
    let mut sessions = Vec::new();
    for sessions_dir in codex_sessions_dirs()? {
        if sessions_dir.is_dir() {
            let title_index = load_codex_session_index_for_sessions_dir(&sessions_dir)?;
            let mut files = Vec::new();
            collect_codex_session_files(&sessions_dir, &mut files)?;
            for path in files {
                let Some(file_stem) = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .map(ToString::to_string)
                else {
                    continue;
                };
                let (source_mtime_ms, source_size_bytes) =
                    imported_paths::file_metadata_signature(&path, "Codex")?;
                let source_fingerprint = codex_source_fingerprint(&file_stem, &title_index);
                sessions.push(ImportedHistoryDiscoveredRecord {
                    source_session_id: file_stem.clone(),
                    source_path: path,
                    source_record_key: file_stem,
                    source_mtime_ms,
                    source_size_bytes,
                    source_fingerprint,
                    parser_version: CODEX_APP_METADATA_PARSER_VERSION,
                });
            }
        }
    }
    Ok(sessions)
}

pub(crate) fn collect_codex_session_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("Failed to read Codex dir: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read Codex dir entry: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_codex_session_files(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "jsonl")
        {
            out.push(path);
        }
    }
    Ok(())
}

pub(crate) fn load_codex_session_index_for_sessions_dir(
    sessions_dir: &Path,
) -> Result<HashMap<String, CodexSessionIndexEntry>, String> {
    let Some(root) = sessions_dir.parent() else {
        return Ok(HashMap::new());
    };
    load_codex_session_index(&root.join("session_index.jsonl"))
}

pub(crate) fn load_codex_session_index(
    index_path: &Path,
) -> Result<HashMap<String, CodexSessionIndexEntry>, String> {
    let mut entries = HashMap::new();
    if !index_path.is_file() {
        return Ok(entries);
    }

    let file = fs::File::open(index_path).map_err(|err| {
        format!(
            "Failed to open Codex session index {}: {err}",
            index_path.display()
        )
    })?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.map_err(|err| {
            format!(
                "Failed to read Codex session index {}: {err}",
                index_path.display()
            )
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: CodexSessionIndexLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let id = parsed.id.trim();
        let thread_name = parsed.thread_name.trim();
        if id.is_empty() || thread_name.is_empty() {
            continue;
        }
        entries.insert(
            id.to_string(),
            CodexSessionIndexEntry {
                thread_name: thread_name.to_string(),
                updated_at: parsed.updated_at,
            },
        );
    }

    Ok(entries)
}

pub(crate) fn codex_source_fingerprint(
    file_stem: &str,
    title_index: &HashMap<String, CodexSessionIndexEntry>,
) -> String {
    codex_title_entry_for_file_stem(file_stem, title_index)
        .map(|entry| {
            format!(
                "session-index:{}:{}",
                entry.updated_at.as_deref().unwrap_or_default(),
                entry.thread_name
            )
        })
        .unwrap_or_default()
}

pub(crate) fn codex_session_index_title_for_record(
    record: &ImportedHistoryDiscoveredRecord,
) -> Result<String, String> {
    let Some(index_path) = codex_index_path_for_session_path(&record.source_path) else {
        return Ok(String::new());
    };
    let title_index = load_codex_session_index(&index_path)?;
    Ok(
        codex_title_entry_for_file_stem(&record.source_record_key, &title_index)
            .map(|entry| imported_history::truncate_name(&entry.thread_name, 200))
            .unwrap_or_default(),
    )
}

pub(crate) fn codex_index_path_for_session_path(session_path: &Path) -> Option<PathBuf> {
    codex_sessions_dir_for_session_path(session_path).and_then(|sessions_dir| {
        sessions_dir
            .parent()
            .map(|root| root.join("session_index.jsonl"))
    })
}

pub(crate) fn codex_sessions_dir_for_session_path(session_path: &Path) -> Option<PathBuf> {
    session_path
        .ancestors()
        .find(|ancestor| ancestor.file_name().and_then(|name| name.to_str()) == Some("sessions"))
        .map(Path::to_path_buf)
}

pub(crate) fn codex_title_entry_for_file_stem<'a>(
    file_stem: &str,
    title_index: &'a HashMap<String, CodexSessionIndexEntry>,
) -> Option<&'a CodexSessionIndexEntry> {
    codex_thread_id_from_file_stem(file_stem).and_then(|thread_id| title_index.get(thread_id))
}

pub(crate) fn codex_thread_id_from_file_stem(file_stem: &str) -> Option<&str> {
    if is_uuid_like(file_stem) {
        return Some(file_stem);
    }
    if file_stem.len() < 36 {
        return None;
    }
    let candidate = &file_stem[file_stem.len() - 36..];
    is_uuid_like(candidate).then_some(candidate)
}

pub(crate) fn is_uuid_like(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    bytes.iter().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            *byte == b'-'
        } else {
            byte.is_ascii_hexdigit()
        }
    })
}

/// Resolve a Codex thread UUID to the concrete rollout file that ORGII can
/// replay. Lifecycle hooks identify the parent with a stable thread UUID, but
/// their common `transcript_path` may point at the active child rollout.
pub fn resolve_codex_transcript_for_thread_id_near_path(
    reference_path: &Path,
    thread_id: &str,
) -> Result<Option<CodexTranscriptLocator>, String> {
    let Some(sessions_dir) = codex_sessions_dir_for_session_path(reference_path) else {
        return Ok(None);
    };
    let find_locator = |mut files: Vec<PathBuf>| {
        files.sort();
        files.into_iter().find_map(|path| {
            let file_stem = path
                .file_stem()
                .and_then(|value| value.to_str())?
                .to_string();
            (codex_thread_id_from_file_stem(&file_stem) == Some(thread_id)).then(|| {
                CodexTranscriptLocator {
                    session_id: super::canonical_session_id(&file_stem),
                    source_session_id: file_stem,
                    source_path: path,
                }
            })
        })
    };

    // Parent and child rollouts from one subagent run normally share the same
    // dated directory. Search that tiny locality before falling back to the
    // full CODEX_HOME session tree, which can contain years of history.
    if let Some(nearby_dir) = reference_path.parent() {
        let mut nearby_files = Vec::new();
        collect_codex_session_files(nearby_dir, &mut nearby_files)?;
        if let Some(locator) = find_locator(nearby_files) {
            return Ok(Some(locator));
        }
    }

    let mut files = Vec::new();
    collect_codex_session_files(&sessions_dir, &mut files)?;
    Ok(find_locator(files))
}
