use super::*;

#[test]
fn parses_trae_time() {
    let ms = parse_trae_time_ms("2026-07-13 12:42:20").expect("parses");
    // Round-trips back to an ISO string.
    let iso = trae_time_to_iso("2026-07-13 12:42:20");
    assert!(iso.starts_with("2026-07-13T12:42:20"));
    assert!(ms > 0);
    assert!(parse_trae_time_ms("not a time").is_none());
    assert!(parse_trae_time_ms("").is_none());
}

#[test]
fn source_id_round_trips_through_prefix() {
    let sid = format!("{TRAE_SESSION_PREFIX}abc123");
    assert_eq!(trae_source_id_from_session_id(&sid).unwrap(), "abc123");
    assert!(trae_source_id_from_session_id("bogus").is_err());
    assert!(trae_source_id_from_session_id(TRAE_SESSION_PREFIX).is_err());
}

#[test]
fn composes_turn_body_from_outcome_actions_learned() {
    let line = TraeMemoryLine {
        intent: "do a thing".to_string(),
        actions: vec!["step one".to_string(), "step two".to_string()],
        outcome: "did the thing".to_string(),
        learned: vec!["a fact".to_string()],
        message_summary_time: "2026-07-13 12:42:20".to_string(),
    };
    let body = compose_turn_body(&line);
    assert!(body.contains("did the thing"));
    assert!(body.contains("Actions:"));
    assert!(body.contains("- step one"));
    assert!(body.contains("Learned:"));
    assert!(body.contains("- a fact"));
}

#[test]
fn decode_project_path_rejects_nonexistent() {
    // A slug that decodes to a path that does not exist yields None.
    assert!(decode_project_path("-no-such-dir-anywhere-xyz").is_none());
}

#[test]
fn projects_dir_candidates_cover_cn_and_intl() {
    let home = std::path::Path::new("/home/u");
    let dirs = trae_projects_dir_candidates(home);
    assert!(dirs.contains(&home.join(".trae-cn").join("memory").join("projects")));
    assert!(dirs.contains(&home.join(".trae").join("memory").join("projects")));
}
