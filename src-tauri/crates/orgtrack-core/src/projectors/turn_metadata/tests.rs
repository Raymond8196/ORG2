use super::*;

#[test]
fn ignores_read_only_and_unknown_tools() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(Some("read_file"), r#"{"file_path":"a.rs"}"#, "{}");
    acc.add_event(None, "{}", "{}");
    assert!(acc.files().is_empty());
}

#[test]
fn edit_file_extracts_path_and_line_stats() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("edit_file"),
        r#"{"file_path":"src/foo.rs"}"#,
        r#"{"success":{"linesAdded":3,"linesRemoved":1}}"#,
    );
    let files = acc.files();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "src/foo.rs");
    assert_eq!(files[0].file_name, "foo.rs");
    assert_eq!(files[0].status, "modified");
    assert_eq!(files[0].additions, 3);
    assert_eq!(files[0].deletions, 1);
}

#[test]
fn create_and_delete_status_mapping() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(Some("create_file"), r#"{"file_path":"new.ts"}"#, "{}");
    acc.add_event(Some("delete_file"), r#"{"file_path":"old.ts"}"#, "{}");
    let files = acc.files();
    assert_eq!(files[0].status, "created");
    assert_eq!(files[1].status, "deleted");
}

#[test]
fn file_name_supports_provider_paths_from_both_platforms() {
    assert_eq!(file_name_for("src/lib.rs"), "lib.rs");
    assert_eq!(file_name_for(r"C:\repo\src\lib.rs"), "lib.rs");
}

#[test]
fn create_file_falls_back_to_content_line_count() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("create_file"),
        r#"{"file_path":"note.md","content":"one\ntwo\nthree"}"#,
        "{}",
    );
    let files = acc.files();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].status, "created");
    assert_eq!(files[0].additions, 3);
    assert_eq!(files[0].deletions, 0);
}

#[test]
fn duplicate_path_merges_and_sums() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("edit_file"),
        r#"{"file_path":"a.rs"}"#,
        r#"{"linesAdded":2,"linesRemoved":0}"#,
    );
    acc.add_event(
        Some("edit_file"),
        r#"{"file_path":"a.rs"}"#,
        r#"{"linesAdded":5,"linesRemoved":3}"#,
    );
    let files = acc.files();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].additions, 7);
    assert_eq!(files[0].deletions, 3);
}

#[test]
fn error_result_is_skipped() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("edit_file"),
        r#"{"file_path":"a.rs"}"#,
        r#"{"content":"Error: permission denied"}"#,
    );
    assert!(acc.files().is_empty());
}

#[test]
fn apply_patch_uses_segments() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("apply_patch"),
        r#"{"patch_text":"*** Update File: a.rs\n"}"#,
        r#"{"segments":[
            {"filePath":"a.rs","linesAdded":4,"linesRemoved":1},
            {"filePath":"b.rs","isDeleted":true}
        ]}"#,
    );
    let files = acc.files();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].path, "a.rs");
    assert_eq!(files[0].additions, 4);
    assert_eq!(files[1].path, "b.rs");
    assert_eq!(files[1].status, "deleted");
}

#[test]
fn apply_patch_falls_back_to_patch_text_with_line_stats() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("apply_patch"),
        r#"{"patch_text":"*** Add File: x.rs\n+one\n+two\n*** Update File: y.rs\n-old\n+new\n context\n"}"#,
        "{}",
    );
    let files = acc.files();
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["x.rs", "y.rs"]);
    assert_eq!(files[0].additions, 2);
    assert_eq!(files[0].deletions, 0);
    assert_eq!(files[1].additions, 1);
    assert_eq!(files[1].deletions, 1);
}

#[test]
fn apply_patch_prefers_patch_text_stats_over_file_paths() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("apply_patch"),
        r#"{"patch_text":"*** Update File: a.rs\n-old\n+new\n+extra\n"}"#,
        r#"{"filePaths":["a.rs"]}"#,
    );
    let files = acc.files();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "a.rs");
    assert_eq!(files[0].additions, 2);
    assert_eq!(files[0].deletions, 1);
}

#[test]
fn malformed_json_is_tolerated() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(Some("edit_file"), "{not json", "{also not json");
    assert!(acc.files().is_empty());
}

#[test]
fn folds_read_metadata_and_drops_searches_across_provider_tool_names() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event_at(
        Some("Read"),
        r#"{"file_path":"src/lib.rs"}"#,
        "{}",
        "2026-07-15T00:00:01Z",
    );
    acc.add_event_at(
        Some("Grep"),
        r#"{"path":"src"}"#,
        r#"{"matches":[{"file":"src/lib.rs"},{"path":"src/main.rs"}]}"#,
        "2026-07-15T00:00:02Z",
    );

    // search-rows: only the read survives — the Grep contributes neither its
    // queried path nor the paths named in its matches.
    let interactions = acc.resource_interactions();
    assert_eq!(interactions.len(), 1);
    assert!(interactions.iter().any(|item| {
        item.path == "src/lib.rs"
            && item.action == ResourceAction::Read
            && item.outcome == ResourceInteractionOutcome::Succeeded
    }));
    assert!(!interactions
        .iter()
        .any(|item| item.action == ResourceAction::Search));
}

#[test]
fn records_failed_observation_but_does_not_claim_a_modification() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event_at(
        Some("replace"),
        r#"{"file_path":"src/lib.rs","new_string":"replacement"}"#,
        r#"{"content":"Error: permission denied"}"#,
        "2026-07-15T00:00:03Z",
    );

    assert!(acc.modified_files().is_empty());
    assert_eq!(acc.resource_interactions().len(), 1);
    assert_eq!(
        acc.resource_interactions()[0].outcome,
        ResourceInteractionOutcome::Failed
    );
}

#[test]
fn shell_artifacts_are_projected_without_host_tool_constants() {
    let mut acc = TurnMetadataAccumulator::new();
    acc.add_event(
        Some("Bash"),
        r#"{"command":"git commit -m metadata"}"#,
        r#"{"success":{"command":"git commit -m metadata","stdout":"[feature abc1234] metadata","exitCode":0}}"#,
    );

    assert_eq!(acc.git_artifacts().len(), 1);
    assert_eq!(acc.git_artifacts()[0].sha.as_deref(), Some("abc1234"));
}

#[test]
fn imported_activity_projection_uses_user_messages_not_execution_threads() {
    let mut first_user = ActivityChunk::new("session-1", "raw", "user_message");
    first_user.chunk_id = "user-1".to_string();
    first_user.created_at = "2026-07-15T00:00:00Z".to_string();
    first_user.args = serde_json::json!({"content": "inspect the code"});
    let mut read = ActivityChunk::new("session-1", "tool_call", "Read");
    read.chunk_id = "read-1".to_string();
    read.thread_id = Some("subagent-9".to_string());
    read.created_at = "2026-07-15T00:00:01Z".to_string();
    read.args = serde_json::json!({"file_path": "src/lib.rs"});
    let mut second_user = ActivityChunk::new("session-1", "raw", "user_message");
    second_user.chunk_id = "user-2".to_string();
    second_user.created_at = "2026-07-15T00:01:00Z".to_string();
    second_user.args = serde_json::json!({"content": "now edit it"});
    let mut edit = ActivityChunk::new("session-1", "tool_call", "replace");
    edit.chunk_id = "edit-1".to_string();
    edit.thread_id = Some("subagent-10".to_string());
    edit.created_at = "2026-07-15T00:01:01Z".to_string();
    edit.args = serde_json::json!({
        "file_path": "src/lib.rs",
        "old_string": "old",
        "new_string": "new"
    });

    let rounds = project_activity_chunks(&[first_user, read, second_user, edit]);

    assert_eq!(rounds.len(), 2);
    assert_eq!(rounds[0].turn_id, "user-1");
    assert_eq!(rounds[1].turn_id, "user-2");
    assert_eq!(
        rounds[0].resource_interactions[0].action,
        ResourceAction::Read
    );
    assert_eq!(rounds[1].modified_files[0].path, "src/lib.rs");
}
