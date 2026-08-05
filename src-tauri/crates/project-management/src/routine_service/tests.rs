//! Integration tests for the routine application service (Phase 4):
//! apply idempotency, revision bumps, and spec-boundary rejection.

use super::*;
use test_helpers::test_env;

fn fixture() -> spec::RoutineSpecFile {
    let raw = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../docs/orgtrack-pm-protocol/fixtures/routine-spec.json"),
    )
    .expect("frozen fixture readable");
    serde_json::from_str(&raw).expect("frozen fixture parses")
}

#[test]
fn apply_is_idempotent_for_identical_canonical_bodies() {
    let _sandbox = test_env::sandbox();
    let file = fixture();

    let first = apply(&file).expect("first apply");
    assert_eq!(first.revision, 1);
    assert!(first.changed);

    let second = apply(&file).expect("second apply");
    assert_eq!(second.revision, 1, "same canonical body keeps the revision");
    assert!(!second.changed);
    assert_eq!(first.spec_hash, second.spec_hash);
}

#[test]
fn apply_bumps_revision_when_the_body_changes() {
    let _sandbox = test_env::sandbox();
    let mut file = fixture();
    let first = apply(&file).expect("first apply");

    file.spec.root_work.title = "改标题：{{ inputs.requirement_id }}".to_string();
    let second = apply(&file).expect("second apply");
    assert_eq!(second.revision, first.revision + 1);
    assert!(second.changed);
    assert_ne!(first.spec_hash, second.spec_hash);
}

#[test]
fn apply_rejects_invalid_specs_with_structured_violations() {
    let _sandbox = test_env::sandbox();
    let mut file = fixture();
    file.spec.steps[0].needs = vec!["archive-and-notify".to_string()];

    let err = apply(&file).expect_err("cycle must be rejected");
    assert!(
        err.starts_with(error::SPEC_INVALID),
        "typed sentinel expected: {err}"
    );
    assert!(err.contains("cycle"), "violation payload rides along: {err}");
}
