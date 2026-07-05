use crate::commands::validate::validate_token_format;

#[test]
fn test_format_validation_from_credentials_file() {
    use serde::Deserialize;
    use std::collections::HashMap;
    use std::fs;

    #[derive(Deserialize)]
    struct CredentialsFile {
        credentials: HashMap<String, StoredCredential>,
    }

    #[derive(Deserialize)]
    struct StoredCredential {
        name: String,
        agent_type: String,
        api_key: Option<String>,
    }

    let creds_path = app_paths::keys();

    if !creds_path.exists() {
        println!("Credentials file not found, skipping test");
        return;
    }

    let contents = fs::read_to_string(&creds_path).expect("Failed to read credentials file");
    let creds_file: CredentialsFile =
        serde_json::from_str(&contents).expect("Failed to parse credentials file");

    println!("\n=== Validating credentials from {:?} ===\n", creds_path);

    for (id, cred) in &creds_file.credentials {
        let api_key = cred.api_key.clone().unwrap_or_default();

        if api_key.is_empty() {
            println!(
                "  [{}] {} ({}) - SKIP: No API key",
                id, cred.name, cred.agent_type
            );
            continue;
        }

        let result = validate_token_format(cred.agent_type.clone(), api_key);

        match result {
            Ok((valid, msg)) => {
                let status = if valid { "PASS" } else { "FAIL" };
                println!(
                    "  [{}] {} ({}) - {}: {}",
                    id, cred.name, cred.agent_type, status, msg
                );
            }
            Err(e) => {
                println!(
                    "  [{}] {} ({}) - ERROR: {}",
                    id, cred.name, cred.agent_type, e
                );
            }
        }
    }

    println!("\n=== Format validation complete ===\n");
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_homebrew() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/opt/homebrew/bin/cursor").as_deref(),
        Some("homebrew")
    );
    assert_eq!(
        infer_install_method("/usr/local/Cellar/foo/1.0/bin/foo").as_deref(),
        Some("homebrew")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_npm() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/projects/app/node_modules/.bin/cursor").as_deref(),
        Some("npm")
    );
    assert_eq!(
        infer_install_method("/Users/x/.nvm/versions/node/v20/bin/cursor").as_deref(),
        Some("npm")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_cargo() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/Users/x/.cargo/bin/cursor-agent").as_deref(),
        Some("cargo")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_pip() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/Users/x/.local/pipx/venvs/foo/bin/foo").as_deref(),
        Some("pip")
    );
    assert_eq!(
        infer_install_method("/home/x/Library/Python/3.11/bin/poetry").as_deref(),
        Some("pip")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_curl() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/usr/local/bin/cursor").as_deref(),
        Some("curl")
    );
}

#[test]
fn test_infer_install_unknown() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/opt/unique-nonstandard-path/bin/my-tool").as_deref(),
        None
    );
}

/// Guards the `save_key` command's `SaveKeyRequest.model_variants` ->
/// `ModelVariant` mapping (crud.rs). A regression that hardcodes
/// `context_window: None` here would silently erase provider-reported context
/// windows on every save, so this test must exercise the conversion directly
/// (not the storage layer, which preserves the field trivially).
#[test]
fn test_model_variant_info_to_variant_preserves_context_window() {
    use crate::commands::crud::ModelVariantInfo;
    use crate::key_store::ModelVariant;

    let with_ctx = ModelVariantInfo {
        model: "gpt-4o".to_string(),
        base_model: "gpt-4o".to_string(),
        reasoning: None,
        fast: false,
        context_window: Some(128_000),
    };
    assert_eq!(ModelVariant::from(with_ctx).context_window, Some(128_000));

    let without_ctx = ModelVariantInfo {
        model: "gpt-4o".to_string(),
        base_model: "gpt-4o".to_string(),
        reasoning: None,
        fast: false,
        context_window: None,
    };
    assert_eq!(ModelVariant::from(without_ctx).context_window, None);

    let zero_ctx = ModelVariantInfo {
        model: "gpt-4o".to_string(),
        base_model: "gpt-4o".to_string(),
        reasoning: None,
        fast: false,
        context_window: Some(0),
    };
    assert_eq!(ModelVariant::from(zero_ctx).context_window, None);
}

#[test]
fn claude_native_key_info_exposes_output_config_effort_variants() {
    use crate::commands::crud::KeyInfo;
    use crate::key_store::{AuthMethod, ModelKey, ModelType, ModelVariant};

    let mut key = ModelKey::new(ModelType::ClaudeCode);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("access-token".to_string());
    key.available_models = vec![
        "claude-opus-4-8".to_string(),
        "claude-haiku-4-5".to_string(),
    ];
    key.model_variants = vec![ModelVariant {
        model: "claude-opus-4-8".to_string(),
        base_model: "claude-opus-4-8".to_string(),
        reasoning: Some("always_on".to_string()),
        fast: false,
        context_window: Some(200_000),
    }];

    let info = KeyInfo::from(key);
    let opus_variants: Vec<_> = info
        .model_variants
        .iter()
        .filter(|variant| variant.base_model == "claude-opus-4-8")
        .collect();

    // Stored record row (always_on, carries the context window) + synthesized
    // low/medium/high/max. The baseline rung collides with the record row's
    // model id and is skipped; no separate xhigh rung (wire-identical to max).
    assert_eq!(opus_variants.len(), 5);
    assert!(opus_variants
        .iter()
        .any(|variant| variant.model == "claude-opus-4-8-high"));
    assert!(opus_variants
        .iter()
        .any(|variant| variant.model == "claude-opus-4-8-max"));
    assert!(opus_variants
        .iter()
        .all(|variant| variant.model != "claude-opus-4-8-xhigh"));
    let record_row = opus_variants
        .iter()
        .find(|variant| variant.model == "claude-opus-4-8")
        .expect("stored record row must survive synthesis");
    assert_eq!(record_row.reasoning.as_deref(), Some("always_on"));
    assert_eq!(record_row.context_window, Some(200_000));
    assert!(info
        .model_variants
        .iter()
        .all(|variant| variant.base_model != "claude-haiku-4-5"));
}

#[test]
fn relay_claude_code_key_gets_no_synthesized_effort_variants() {
    use crate::commands::crud::KeyInfo;
    use crate::key_store::{AuthMethod, ModelKey, ModelType, ModelVariant};

    let mut key = ModelKey::new(ModelType::ClaudeCode);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("mirror-token".to_string());
    key.base_url = Some("https://claude-relay.example/api".to_string());
    key.available_models = vec!["claude-opus-4-8".to_string()];
    key.model_variants = vec![ModelVariant {
        model: "claude-opus-4-8".to_string(),
        base_model: "claude-opus-4-8".to_string(),
        reasoning: None,
        fast: false,
        context_window: Some(128_000),
    }];

    let info = KeyInfo::from(key);
    // Third-party relay: stored rows pass through untouched, nothing added.
    assert_eq!(info.model_variants.len(), 1);
    assert_eq!(info.model_variants[0].model, "claude-opus-4-8");
    assert_eq!(info.model_variants[0].context_window, Some(128_000));
}

#[test]
fn third_party_anthropic_protocol_key_keeps_record_rows_untouched() {
    use crate::commands::crud::KeyInfo;
    use crate::key_store::{ModelKey, ModelType, ModelVariant, ProviderProtocol};

    let mut key = ModelKey::new(ModelType::OpenrouterApi);
    key.protocol = Some(ProviderProtocol::Anthropic);
    key.available_models = vec!["claude-sonnet-4-6".to_string()];
    key.model_variants = vec![ModelVariant {
        model: "claude-sonnet-4-6".to_string(),
        base_model: "claude-sonnet-4-6".to_string(),
        reasoning: None,
        fast: false,
        context_window: Some(131_072),
    }];

    let info = KeyInfo::from(key);
    // Anthropic-protocol third parties are NOT native: no synthesis, and the
    // provider-reported context window row survives for the usage display.
    assert_eq!(info.model_variants.len(), 1);
    assert_eq!(info.model_variants[0].context_window, Some(131_072));
    assert_eq!(info.model_variants[0].reasoning, None);
}

#[test]
fn sonnet_ladders_follow_reference_effort_limits() {
    use crate::commands::crud::KeyInfo;
    use crate::key_store::{ModelKey, ModelType};

    let mut key = ModelKey::new(ModelType::AnthropicApi);
    key.api_key = Some("sk-ant-test".to_string());
    key.available_models = vec![
        "claude-sonnet-4-6".to_string(),
        "claude-sonnet-5".to_string(),
    ];

    let info = KeyInfo::from(key);
    // sonnet-4-6 supports effort but not `max` (Opus-4.6-only per the
    // reference harness).
    assert!(info
        .model_variants
        .iter()
        .any(|variant| variant.model == "claude-sonnet-4-6-high"));
    assert!(info
        .model_variants
        .iter()
        .all(|variant| variant.model != "claude-sonnet-4-6-max"));
    // sonnet-5 is not effort-capable (agent_core classifies it as legacy
    // budget thinking): no synthesized ladder at all.
    assert!(info
        .model_variants
        .iter()
        .all(|variant| variant.base_model != "claude-sonnet-5"));
}
