use super::launch_helpers::{
    apply_member_launch_overrides_to_snapshot, member_runtime_account_id,
    member_runtime_key_source, member_runtime_model, member_runtime_native_harness_type,
    member_runtime_tier, validate_launch_agent_definitions, validate_launch_resources,
    validate_own_key_pair,
};
use super::LaunchResourceSelection;
use crate::coordination::agent_org_runs::COORDINATOR_MEMBER_ID;
use crate::definitions::builtin::SDE_AGENT_ID;
use crate::definitions::orgs::{
    HierarchyMode, OrgDefinition, OrgMember, OrgMemberLaunchOverride, OrgMemberRuntimeConfig,
    PlanApprovalPolicy,
};
use core_types::key_source::KeySource;
use key_vault::key_store::{ModelKey, ModelType, ModelVariant, KEY_SERVICE};
use std::collections::HashMap;

#[test]
fn session_marker_writes_explicit_build_for_legacy_null_product_mode() {
    let workspace = tempfile::tempdir().expect("workspace");
    super::write_agent_session_marker(
        workspace.path().to_str().expect("workspace path"),
        "build-session",
        Some("builtin:sde"),
        None,
        Some("scoped-project"),
        Some("personal-org"),
    );
    let marker =
        std::fs::read_to_string(workspace.path().join(".orgii/agent_session_context.json"))
            .expect("read marker");
    let marker: serde_json::Value = serde_json::from_str(&marker).expect("parse marker");
    assert_eq!(marker["productMode"], "build");
    assert_eq!(marker["scope"], "scoped-project");
    assert_eq!(marker["capabilities"], serde_json::json!(["work.read"]));
}

#[test]
fn launch_validation_rejects_missing_agent_definition_before_session_create() {
    let _sandbox = test_helpers::test_env::sandbox();

    let error = validate_launch_agent_definitions(Some("custom:missing-launch-agent"), None)
        .expect_err("missing explicit definition must fail before session creation");

    assert!(error.contains("custom:missing-launch-agent"), "{error}");
    assert!(error.contains("does not exist"), "{error}");
}

#[test]
fn launch_validation_rejects_model_without_account_before_session_create() {
    let error = validate_launch_resources(&LaunchResourceSelection {
        key_source: Some("own_key".to_string()),
        account_id: None,
        model: Some("gpt-5.5".to_string()),
        native_harness_type: None,
    })
    .expect_err("a half-selected execution pair must fail before persistence");

    assert!(error.contains("account_unavailable"), "{error}");
    assert!(error.contains("without a Code Account"), "{error}");
}

#[test]
fn launch_validation_rejects_missing_or_disabled_account_and_mismatched_model() {
    let missing = validate_own_key_pair("deleted-account", "gpt-5.5", None)
        .expect_err("a deleted account must fail before persistence");
    assert!(missing.contains("account_unavailable"), "{missing}");

    let mut key = ModelKey::new(ModelType::OpenaiApi);
    key.id = "account-1".to_string();
    key.enabled_models = vec!["gpt-5.5".to_string()];
    key.enabled = false;

    let disabled = validate_own_key_pair("account-1", "gpt-5.5", Some(&key))
        .expect_err("disabled account must fail before persistence");
    assert!(disabled.contains("account_unavailable"), "{disabled}");

    key.enabled = true;
    let mismatched = validate_own_key_pair("account-1", "claude-opus-4.6", Some(&key))
        .expect_err("model outside the account selection must fail");
    assert!(mismatched.contains("model_unavailable"), "{mismatched}");
}

#[test]
fn launch_validation_accepts_enabled_model_variants() {
    let mut key = ModelKey::new(ModelType::OpenaiApi);
    key.id = "account-1".to_string();
    key.enabled_models = vec!["gpt-5.5".to_string()];
    key.model_variants = vec![ModelVariant {
        model: "gpt-5.5-high".to_string(),
        base_model: "gpt-5.5".to_string(),
        reasoning: Some("high".to_string()),
        fast: false,
        context_window: None,
    }];

    assert!(validate_own_key_pair("account-1", "gpt-5.5-high", Some(&key)).is_ok());
}

#[test]
fn launch_validation_rejects_partial_and_unregistered_model_prefixes() {
    let mut key = ModelKey::new(ModelType::OpenaiApi);
    key.id = "account-1".to_string();
    key.enabled_models = vec!["gpt-5.5".to_string()];

    assert!(validate_own_key_pair("account-1", "gpt", Some(&key)).is_err());
    assert!(validate_own_key_pair("account-1", "gpt-5.5-unknown", Some(&key)).is_err());
}

#[test]
fn launch_validation_checks_real_provider_credentials_before_persistence() {
    crate::test_support::install_crypto_provider_for_tests();
    let _sandbox = test_helpers::test_env::sandbox();
    let mut key = ModelKey::new(ModelType::OpenaiApi);
    key.id = "provider-account".to_string();
    key.api_key = Some("test-api-key".to_string());
    key.enabled_models = vec!["gpt-test".to_string()];
    KEY_SERVICE.save_key(key).expect("save provider account");

    let validated = validate_launch_resources(&LaunchResourceSelection {
        key_source: Some("own_key".to_string()),
        account_id: Some("provider-account".to_string()),
        model: Some("gpt-test".to_string()),
        native_harness_type: None,
    })
    .expect("usable provider account must pass preflight");

    assert_eq!(validated, None);

    let mut key = ModelKey::new(ModelType::CursorCli);
    key.id = "cursor-account".to_string();
    key.session_token = Some("cursor-session-token".to_string());
    key.enabled_models = vec!["composer-2".to_string()];
    KEY_SERVICE.save_key(key).expect("save Cursor account");

    let without_harness = validate_launch_resources(&LaunchResourceSelection {
        key_source: Some("own_key".to_string()),
        account_id: Some("cursor-account".to_string()),
        model: Some("composer-2".to_string()),
        native_harness_type: None,
    })
    .expect_err("Cursor is not a direct Rust provider");
    assert!(without_harness.contains("account_unavailable"));

    let with_harness = validate_launch_resources(&LaunchResourceSelection {
        key_source: Some("own_key".to_string()),
        account_id: Some("cursor-account".to_string()),
        model: Some("composer-2".to_string()),
        native_harness_type: Some("cursor_native".to_string()),
    })
    .expect("Cursor native harness must pass preflight");
    assert_eq!(
        with_harness,
        Some(core_types::providers::NativeHarnessType::CursorNative)
    );
}

fn valid_org_with_children(children: Vec<OrgMember>) -> OrgDefinition {
    OrgDefinition {
        id: "test:member-id-org".to_string(),
        name: "Member Id Org".to_string(),
        role: "Coordinator".to_string(),
        agent_id: SDE_AGENT_ID.to_string(),
        description: None,
        hierarchy_mode: HierarchyMode::Soft,
        plan_approval_policy: PlanApprovalPolicy::Coordinator,
        children,
    }
}

#[test]
fn launch_overrides_apply_recursively_to_effective_org_snapshot() {
    let mut org = valid_org_with_children(vec![OrgMember {
        id: "lead".to_string(),
        name: "Lead".to_string(),
        role: "Lead".to_string(),
        agent_id: SDE_AGENT_ID.to_string(),
        runtime_config: None,
        children: vec![OrgMember {
            id: "child".to_string(),
            name: "Child".to_string(),
            role: "Worker".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: Vec::new(),
        }],
    }]);
    let mut overrides = HashMap::new();
    overrides.insert(
        "child".to_string(),
        OrgMemberLaunchOverride {
            agent_id: Some("cli:claude_code".to_string()),
            runtime_config: Some(OrgMemberRuntimeConfig {
                key_source: Some("own_key".to_string()),
                account_id: Some("account-child".to_string()),
                model: Some("child-model".to_string()),
                ..Default::default()
            }),
        },
    );

    apply_member_launch_overrides_to_snapshot(&mut org.children, &overrides)
        .expect("override should apply");

    let child = &org.children[0].children[0];
    assert_eq!(child.agent_id, "cli:claude_code");
    let runtime_config = child.runtime_config.as_ref().expect("runtime config");
    assert_eq!(runtime_config.account_id.as_deref(), Some("account-child"));
    assert_eq!(runtime_config.model.as_deref(), Some("child-model"));
}

#[test]
fn launch_overrides_reject_unknown_member_ids() {
    let mut org = valid_org_with_children(vec![OrgMember {
        id: "lead".to_string(),
        name: "Lead".to_string(),
        role: "Lead".to_string(),
        agent_id: SDE_AGENT_ID.to_string(),
        runtime_config: None,
        children: Vec::new(),
    }]);
    let mut overrides = HashMap::new();
    overrides.insert(
        "missing".to_string(),
        OrgMemberLaunchOverride {
            agent_id: Some("cli:claude_code".to_string()),
            runtime_config: None,
        },
    );

    let error = apply_member_launch_overrides_to_snapshot(&mut org.children, &overrides)
        .expect_err("unknown member override must fail");

    assert!(error.contains("missing"), "{error}");
}

#[test]
fn member_runtime_resolution_prefers_member_config_then_falls_back() {
    let fallback_model = Some("fallback-model".to_string());
    let fallback_account = Some("fallback-account".to_string());
    let fallback_harness = Some("cursor_native".to_string());
    let config = OrgMemberRuntimeConfig {
        key_source: Some("hosted_key".to_string()),
        account_id: Some(" member-account ".to_string()),
        model: None,
        listing_model: Some(" listing-model ".to_string()),
        native_harness_type: Some("cursor_native".to_string()),
        tier: Some("premium".to_string()),
        ..Default::default()
    };

    assert_eq!(
        member_runtime_model(Some(&config), &fallback_model).as_deref(),
        Some("listing-model")
    );
    assert_eq!(
        member_runtime_account_id(Some(&config), &fallback_account).as_deref(),
        Some("member-account")
    );
    assert_eq!(
        member_runtime_tier(Some(&config)).as_deref(),
        Some("premium")
    );
    assert_eq!(
        member_runtime_key_source(Some(&config), &KeySource::OwnKey).expect("key source"),
        KeySource::HostedKey
    );
    assert_eq!(
        member_runtime_native_harness_type(Some(&config), &fallback_harness)
            .expect("native harness")
            .as_deref(),
        Some("cursor_native")
    );
}

#[test]
fn launch_validation_rejects_agent_org_with_missing_member_definition() {
    let _sandbox = test_helpers::test_env::sandbox();
    let org = OrgDefinition {
        id: "test:missing-member-org".to_string(),
        name: "Missing Member Org".to_string(),
        role: "Coordinator".to_string(),
        agent_id: SDE_AGENT_ID.to_string(),
        description: None,
        hierarchy_mode: HierarchyMode::Soft,
        plan_approval_policy: PlanApprovalPolicy::Coordinator,
        children: vec![OrgMember {
            id: "worker".to_string(),
            name: "Worker".to_string(),
            role: "Builder".to_string(),
            agent_id: "custom:deleted-worker".to_string(),
            runtime_config: None,
            children: Vec::new(),
        }],
    };

    let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
        .expect_err("missing org member definition must fail before materialization");

    assert!(error.contains("Missing Member Org"), "{error}");
    assert!(error.contains("custom:deleted-worker"), "{error}");
}

#[test]
fn launch_validation_rejects_cli_member_before_run_materialization() {
    let _sandbox = test_helpers::test_env::sandbox();
    let org = valid_org_with_children(vec![OrgMember {
        id: "cli-worker".to_string(),
        name: "CLI Worker".to_string(),
        role: "Builder".to_string(),
        agent_id: "cli:claude_code".to_string(),
        runtime_config: None,
        children: Vec::new(),
    }]);

    let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
        .expect_err("CLI Agent Org members are not production-capable yet");
    assert!(error.contains("cli-worker"), "{error}");
    assert!(error.contains("cli:claude_code"), "{error}");
    assert!(error.contains("inbox"), "{error}");
}

#[test]
fn launch_validation_rejects_duplicate_member_ids() {
    let _sandbox = test_helpers::test_env::sandbox();
    let org = valid_org_with_children(vec![
        OrgMember {
            id: "worker".to_string(),
            name: "Worker A".to_string(),
            role: "Builder".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: Vec::new(),
        },
        OrgMember {
            id: "worker".to_string(),
            name: "Worker B".to_string(),
            role: "Reviewer".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: Vec::new(),
        },
    ]);

    let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
        .expect_err("duplicate member_id must fail before session creation");

    assert!(error.contains("duplicate member_id"), "{error}");
    assert!(error.contains("worker"), "{error}");
}

#[test]
fn launch_validation_rejects_reserved_and_empty_member_ids() {
    let _sandbox = test_helpers::test_env::sandbox();
    let org = valid_org_with_children(vec![
        OrgMember {
            id: COORDINATOR_MEMBER_ID.to_string(),
            name: "Reserved".to_string(),
            role: "Builder".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: Vec::new(),
        },
        OrgMember {
            id: " ".to_string(),
            name: "Blank".to_string(),
            role: "Reviewer".to_string(),
            agent_id: SDE_AGENT_ID.to_string(),
            runtime_config: None,
            children: Vec::new(),
        },
    ]);

    let error = validate_launch_agent_definitions(Some(SDE_AGENT_ID), Some(&org))
        .expect_err("invalid member_id values must fail before session creation");

    assert!(error.contains("reserved id"), "{error}");
    assert!(error.contains("empty id"), "{error}");
}
