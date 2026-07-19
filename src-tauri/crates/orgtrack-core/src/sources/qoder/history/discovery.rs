use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

use super::*;

use crate::sources::imported_history::cache as imported_cache;
use crate::sources::imported_history::metadata::{ImportedHistoryDiscoveredRecord, SOURCE_QODER};
use crate::sources::imported_history::paths as imported_paths;

pub(super) fn sync_qoder_history_cache(conn: &mut Connection) -> Result<(), String> {
    let discovered = discover_qoder_history_records()?;
    let signatures = discovered
        .iter()
        .map(QoderDiscoveredRecord::signature)
        .collect::<Vec<_>>();
    let changed =
        imported_cache::changed_records_from_conn(conn, SOURCE_QODER, &discovered, |record| {
            record.signature()
        })?;
    let inputs = changed
        .into_iter()
        .map(|record| session_meta_to_cache_input(parse_qoder_session_meta(record)))
        .collect();
    imported_cache::sync_source_cache_from_conn(
        conn,
        SOURCE_QODER,
        imported_cache::live_ids_from_signatures(&signatures),
        inputs,
    )
}

fn discover_qoder_history_records() -> Result<Vec<QoderDiscoveredRecord>, String> {
    let snapshot_tasks = read_quest_snapshot_tasks();
    let mut records = Vec::new();
    for projects_dir in qoder_projects_dirs()? {
        records.extend(discover_records_in_projects_dir(
            &projects_dir,
            &snapshot_tasks,
        )?);
    }
    Ok(records)
}

pub(super) fn discover_records_in_projects_dir(
    projects_dir: &Path,
    snapshot_tasks: &[QoderQuestTask],
) -> Result<Vec<QoderDiscoveredRecord>, String> {
    let mut records = Vec::new();
    if !projects_dir.is_dir() {
        return Ok(records);
    }
    let Ok(project_entries) = fs::read_dir(projects_dir) else {
        return Ok(records);
    };
    for project_entry in project_entries.flatten() {
        let project_dir = project_entry.path();
        let Some(project_dir_name) = project_dir.file_name().and_then(|name| name.to_str())
        else {
            continue;
        };
        let history_dir = project_dir.join(CONVERSATION_HISTORY_DIR);
        let Ok(task_entries) = fs::read_dir(&history_dir) else {
            continue;
        };
        for task_entry in task_entries.flatten() {
            let task_dir = task_entry.path();
            let Some(task_dir_name) = task_dir.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let transcript_path = task_dir.join(format!("{task_dir_name}.jsonl"));
            if !transcript_path.is_file() {
                continue;
            }
            let (source_mtime_ms, source_size_bytes) =
                imported_paths::file_metadata_signature(&transcript_path, "Qoder")?;
            let snapshot =
                match_snapshot_task(snapshot_tasks, project_dir_name, task_dir_name).cloned();
            let source_session_id = format!("{project_dir_name}/{task_dir_name}");
            // Fold in the edit-store signature so edits landing after a sync
            // re-parse the session even when the transcript is unchanged.
            let source_fingerprint = format!(
                "{}|edits:{}",
                snapshot
                    .as_ref()
                    .map(quest_task_fingerprint)
                    .unwrap_or_default(),
                super::super::log_enrichment::edit_store_signature(
                    task_dir_name,
                    snapshot.as_ref().map(|task| task.id.as_str()),
                ),
            );
            records.push(QoderDiscoveredRecord {
                record: ImportedHistoryDiscoveredRecord {
                    source_session_id: source_session_id.clone(),
                    source_path: transcript_path,
                    source_record_key: source_session_id,
                    source_mtime_ms,
                    source_size_bytes,
                    source_fingerprint,
                    parser_version: QODER_METADATA_PARSER_VERSION,
                },
                snapshot,
            });
        }
    }
    Ok(records)
}

/// Match a conversation-history dir to its quest-snapshot entry. The task dir
/// name is a truncated prefix of the full quest id, and the project cache dir
/// is `<workspace-basename>-<hash>`, so require both to line up.
pub(super) fn match_snapshot_task<'a>(
    tasks: &'a [QoderQuestTask],
    project_dir_name: &str,
    task_dir_name: &str,
) -> Option<&'a QoderQuestTask> {
    tasks.iter().find(|task| {
        !task.id.is_empty()
            && task.id.starts_with(task_dir_name)
            && project_dir_matches_workspace(project_dir_name, &task.file_path)
    })
}

pub(super) fn project_dir_matches_workspace(project_dir_name: &str, workspace_path: &str) -> bool {
    let Some(basename) = Path::new(workspace_path.trim())
        .file_name()
        .and_then(|name| name.to_str())
    else {
        return false;
    };
    project_dir_name
        .strip_prefix(basename)
        .is_some_and(|rest| rest.starts_with('-'))
}

/// Fields that feed name/timestamps/repo-path, so a snapshot-side change
/// (rename, new activity) re-parses the session even when the JSONL is
/// untouched.
fn quest_task_fingerprint(task: &QoderQuestTask) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        task.id,
        task.name,
        task.title,
        task.query,
        task.create_time,
        task.updated_at_timestamp,
        task.last_user_query_at,
        task.file_path,
    )
}

/// Best-effort read of the quest task list from Qoder's global `state.vscdb`.
/// The running app may hold the database, so any failure degrades to "no
/// enrichment" instead of failing discovery.
fn read_quest_snapshot_tasks() -> Vec<QoderQuestTask> {
    qoder_global_state_db_candidates()
        .into_iter()
        .filter(|path| path.is_file())
        .find_map(|path| read_quest_snapshot_tasks_from_db(&path).ok())
        .unwrap_or_default()
}

fn read_quest_snapshot_tasks_from_db(path: &Path) -> Result<Vec<QoderQuestTask>, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|err| format!("Failed to open Qoder state db {}: {err}", path.display()))?;
    let raw = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            [QUEST_SNAPSHOT_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("Failed to read Qoder quest snapshot: {err}"))?;
    Ok(raw
        .as_deref()
        .map(parse_quest_snapshot_tasks)
        .unwrap_or_default())
}

/// Snapshot shape: `{version, updatedAt, folders: {<key>: {tasks: [task…]}}}`.
pub(super) fn parse_quest_snapshot_tasks(raw: &str) -> Vec<QoderQuestTask> {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(folders) = value.get("folders").and_then(Value::as_object) else {
        return Vec::new();
    };
    folders
        .values()
        .filter_map(|folder| folder.get("tasks").and_then(Value::as_array))
        .flatten()
        .filter_map(|task| serde_json::from_value(task.clone()).ok())
        .collect()
}

/// Existing-store probe locations for the Data Sources inventory.
pub fn qoder_history_candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.extend(qoder_projects_dir_candidates(&home));
    }
    paths.extend(qoder_global_state_db_candidates());
    imported_paths::dedupe_paths(paths)
}

pub(super) fn qoder_projects_dirs() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Home directory not found".to_string())?;
    Ok(qoder_projects_dir_candidates(&home))
}

/// `~/.qoder/cache/projects` — the per-project conversation-history root.
pub(super) fn qoder_projects_dir_candidates(home: &Path) -> Vec<PathBuf> {
    vec![home.join(".qoder").join("cache").join("projects")]
}

/// VS Code-family per-user data root: `Qoder/User/globalStorage/state.vscdb`.
fn qoder_global_state_db_candidates() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(data) = dirs::data_dir() {
        roots.push(data);
    }
    if let Some(config) = dirs::config_dir() {
        roots.push(config);
    }
    roots.sort();
    roots.dedup();
    roots
        .into_iter()
        .map(|root| {
            root.join("Qoder")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb")
        })
        .collect()
}
