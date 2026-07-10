use axum::{
    body::{to_bytes, Body},
    extract::Path,
    http::{header::CONTENT_TYPE, HeaderMap, Method, Request, Response, StatusCode},
    response::IntoResponse,
    routing::{any, get},
    Json, Router,
};
use key_vault::key_store::KEY_SERVICE;
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MANAGED_CODEX_AGENT: &str = "codex";
const MANAGED_CLAUDE_CODE_AGENT: &str = "claude_code";
const DEFAULT_PROXY_PORT: u16 = 17888;
const DEFAULT_PROXY_URL: &str = "http://127.0.0.1:17888";
const DEFAULT_CODEX_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const ORGII_CURRENT_MODEL: &str = "orgii-current-model";
const MAX_PROXY_BODY_BYTES: usize = 64 * 1024 * 1024;

static PROXY_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliManagedProxyStatus {
    pub agent_name: String,
    pub supported: bool,
    pub running: bool,
    pub ready: bool,
    pub url: String,
    pub selected_key_id: Option<String>,
    pub selected_provider: Option<String>,
    pub selected_model: Option<String>,
    pub upstream_base_url: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum ProxyProtocol {
    OpenAi,
    Anthropic,
}

#[derive(Debug, Clone)]
struct ProxyContext {
    key_id: String,
    provider: String,
    model: String,
    upstream_base_url: String,
    api_key: String,
    protocol: ProxyProtocol,
}

pub fn start_cli_managed_proxy_thread() {
    if PROXY_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(|| match tokio::runtime::Runtime::new() {
        Ok(rt) => {
            rt.block_on(async {
                if let Err(err) = run_proxy_server().await {
                    PROXY_STARTED.store(false, Ordering::SeqCst);
                    tracing::warn!(error = %err, "[CLI Managed Proxy] stopped");
                }
            });
        }
        Err(err) => {
            PROXY_STARTED.store(false, Ordering::SeqCst);
            tracing::error!(error = %err, "[CLI Managed Proxy] failed to create tokio runtime");
        }
    });
}

async fn run_proxy_server() -> Result<(), String> {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], DEFAULT_PROXY_PORT));
    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/v1/{*path}", any(proxy_v1_handler))
        .route("/claude/{*path}", any(proxy_claude_handler));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|err| format!("Failed to bind {addr}: {err}"))?;

    tracing::info!("[CLI Managed Proxy] listening on http://{}", addr);
    axum::serve(listener, app)
        .await
        .map_err(|err| format!("Proxy server error: {err}"))
}

async fn health_handler() -> impl IntoResponse {
    match cli_managed_proxy_status(MANAGED_CODEX_AGENT.to_string()).await {
        Ok(status) => (StatusCode::OK, Json(status)).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ready": false, "message": err })),
        )
            .into_response(),
    }
}

async fn proxy_v1_handler(Path(path): Path<String>, request: Request<Body>) -> Response<Body> {
    proxy_agent_handler(MANAGED_CODEX_AGENT, path, request).await
}

async fn proxy_claude_handler(Path(path): Path<String>, request: Request<Body>) -> Response<Body> {
    proxy_agent_handler(MANAGED_CLAUDE_CODE_AGENT, path, request).await
}

async fn proxy_agent_handler(
    agent_name: &str,
    path: String,
    request: Request<Body>,
) -> Response<Body> {
    let context = match resolve_proxy_context(agent_name) {
        Ok(context) => context,
        Err(err) => {
            return json_error(StatusCode::PRECONDITION_FAILED, err);
        }
    };

    let (parts, body) = request.into_parts();
    let body_bytes = match to_bytes(body, MAX_PROXY_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(err) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                format!("Failed to read proxy request body: {err}"),
            );
        }
    };

    let mut outbound_body = body_bytes.to_vec();
    if is_json_request(&parts.headers) && !outbound_body.is_empty() {
        if let Ok(mut value) = serde_json::from_slice::<Value>(&outbound_body) {
            rewrite_model_field(&mut value, &context.model);
            match serde_json::to_vec(&value) {
                Ok(bytes) => outbound_body = bytes,
                Err(err) => {
                    return json_error(
                        StatusCode::BAD_REQUEST,
                        format!("Failed to serialize proxy request body: {err}"),
                    );
                }
            }
        }
    }

    forward_request(parts.method, &parts.headers, &context, &path, outbound_body).await
}

async fn forward_request(
    method: Method,
    incoming_headers: &HeaderMap,
    context: &ProxyContext,
    path: &str,
    body: Vec<u8>,
) -> Response<Body> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let url = match context.protocol {
        ProxyProtocol::OpenAi => build_upstream_url(&context.upstream_base_url, path),
        ProxyProtocol::Anthropic => build_anthropic_upstream_url(&context.upstream_base_url, path),
    };

    let req_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST);
    let mut builder = client.request(req_method, url);

    for (name, value) in incoming_headers {
        if should_forward_header(name.as_str()) {
            builder = builder.header(name.as_str(), value.as_bytes());
        }
    }

    builder = apply_auth_header(
        builder,
        &context.protocol,
        &context.provider,
        &context.api_key,
    );
    if !incoming_headers.contains_key(CONTENT_TYPE) {
        builder = builder.header(CONTENT_TYPE.as_str(), "application/json");
    }

    let response = match builder.body(body).send().await {
        Ok(response) => response,
        Err(err) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to connect to upstream provider: {err}"),
            );
        }
    };

    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let headers = response.headers().clone();
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to read upstream response: {err}"),
            );
        }
    };

    let mut out = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if should_forward_response_header(name.as_str()) {
            out = out.header(name, value);
        }
    }
    out.body(Body::from(bytes)).unwrap_or_else(|err| {
        json_error(
            StatusCode::BAD_GATEWAY,
            format!("Failed to build proxy response: {err}"),
        )
    })
}

fn is_json_request(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("json"))
        .unwrap_or(true)
}

fn rewrite_model_field(value: &mut Value, selected_model: &str) {
    let Some(object) = value.as_object_mut() else {
        return;
    };

    match object.get("model").and_then(Value::as_str) {
        Some(model) if model == ORGII_CURRENT_MODEL || model != selected_model => {
            object.insert(
                "model".to_string(),
                Value::String(selected_model.to_string()),
            );
        }
        None => {
            object.insert(
                "model".to_string(),
                Value::String(selected_model.to_string()),
            );
        }
        _ => {}
    }
}

fn build_upstream_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let path = path.trim_start_matches('/');
    if path.is_empty() {
        base.to_string()
    } else {
        format!("{base}/{path}")
    }
}

fn build_anthropic_upstream_url(base_url: &str, path: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let path = path.trim_start_matches('/');
    let path = if base.ends_with("/v1") {
        path.strip_prefix("v1/").unwrap_or(path)
    } else {
        path
    };
    build_upstream_url(base, path)
}

fn should_forward_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !matches!(
        lower.as_str(),
        "authorization"
            | "x-api-key"
            | "api-key"
            | "host"
            | "content-length"
            | "connection"
            | "proxy-authorization"
            | "proxy-authenticate"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn should_forward_response_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !matches!(
        lower.as_str(),
        "content-length"
            | "connection"
            | "proxy-authorization"
            | "proxy-authenticate"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn apply_auth_header(
    builder: reqwest::RequestBuilder,
    protocol: &ProxyProtocol,
    provider: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    match protocol {
        ProxyProtocol::OpenAi if provider == "azure_openai_api" => {
            builder.header("api-key", api_key)
        }
        ProxyProtocol::OpenAi => builder.header("Authorization", format!("Bearer {api_key}")),
        ProxyProtocol::Anthropic if provider == "azure_anthropic_api" => {
            builder.header("api-key", api_key)
        }
        ProxyProtocol::Anthropic => builder.header("x-api-key", api_key),
    }
}

fn responses_compatibility_note(provider: &str) -> Option<String> {
    if matches!(provider, "openai_api" | "codex") {
        None
    } else {
        Some(
            "Codex managed proxy currently forwards OpenAI Responses requests; this provider must support /v1/responses."
                .to_string(),
        )
    }
}

fn proxy_compatibility_note(context: &ProxyContext) -> Option<String> {
    match context.protocol {
        ProxyProtocol::OpenAi => responses_compatibility_note(&context.provider),
        ProxyProtocol::Anthropic => None,
    }
}

fn resolve_proxy_context(agent_name: &str) -> Result<ProxyContext, String> {
    let protocol = match agent_name {
        MANAGED_CODEX_AGENT => ProxyProtocol::OpenAi,
        MANAGED_CLAUDE_CODE_AGENT => ProxyProtocol::Anthropic,
        _ => {
            return Err(
                "CLI managed proxy only supports Codex and Claude Code in this build".to_string(),
            )
        }
    };

    let protocol_name = match protocol {
        ProxyProtocol::OpenAi => "openai",
        ProxyProtocol::Anthropic => "anthropic",
    };

    let agent_display = match agent_name {
        MANAGED_CODEX_AGENT => "Codex",
        MANAGED_CLAUDE_CODE_AGENT => "Claude Code",
        _ => agent_name,
    };

    if agent_name != MANAGED_CODEX_AGENT && agent_name != MANAGED_CLAUDE_CODE_AGENT {
        return Err(
            "CLI managed proxy only supports Codex and Claude Code in this build".to_string(),
        );
    }

    let selection = agent_cli::managed_config::managed_selection_for_agent(agent_name)?
        .ok_or_else(|| format!("{agent_display} is not in ORGII Managed config mode"))?;
    let key_id = selection
        .selected_key_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("No KeyVault key selected for {agent_display} managed config"))?;

    let key = KEY_SERVICE
        .get_key_by_id(&key_id)
        .ok_or_else(|| format!("Selected KeyVault key does not exist: {key_id}"))?;

    if !key.enabled {
        return Err("Selected KeyVault key is disabled".to_string());
    }

    let provider = key.model_type.as_str().to_string();

    let provider_config = key_vault::provider_config::get_provider_config(&provider);
    if !provider_config
        .supported_protocols
        .iter()
        .any(|protocol| protocol == protocol_name)
    {
        return Err(format!(
            "Provider {provider} is not {protocol_name}-compatible for {agent_display} managed proxy"
        ));
    }

    let api_key = key
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Selected key has no API key material. OAuth/subscription proxying is not supported yet."
                .to_string()
        })?
        .to_string();

    let upstream_base_url = key
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| match protocol {
            ProxyProtocol::OpenAi => provider_config.default_base_url.clone(),
            ProxyProtocol::Anthropic => provider_config
                .default_anthropic_base_url()
                .or(provider_config.default_base_url.clone()),
        })
        .or_else(|| {
            if matches!(protocol, ProxyProtocol::OpenAi) && provider == MANAGED_CODEX_AGENT {
                Some(DEFAULT_CODEX_OPENAI_BASE_URL.to_string())
            } else if matches!(protocol, ProxyProtocol::Anthropic)
                && provider == MANAGED_CLAUDE_CODE_AGENT
            {
                Some(DEFAULT_ANTHROPIC_BASE_URL.to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| format!("Provider {provider} requires a base URL before proxying"))?;

    let model = selection
        .selected_model
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| key.enabled_models.first().cloned())
        .or_else(|| key.available_models.first().cloned())
        .ok_or_else(|| "No model selected for Codex managed config".to_string())?;

    Ok(ProxyContext {
        key_id,
        provider,
        model,
        upstream_base_url,
        api_key,
        protocol,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cli_managed_proxy_status(agent_name: String) -> Result<CliManagedProxyStatus, String> {
    let running = PROXY_STARTED.load(Ordering::SeqCst);
    let url = DEFAULT_PROXY_URL.to_string();

    if agent_name != MANAGED_CODEX_AGENT && agent_name != MANAGED_CLAUDE_CODE_AGENT {
        return Ok(CliManagedProxyStatus {
            agent_name,
            supported: false,
            running,
            ready: false,
            url,
            selected_key_id: None,
            selected_provider: None,
            selected_model: None,
            upstream_base_url: None,
            message: Some(
                "CLI managed proxy only supports Codex and Claude Code in this build".to_string(),
            ),
        });
    }

    match resolve_proxy_context(&agent_name) {
        Ok(context) => {
            let message = if running {
                proxy_compatibility_note(&context)
            } else {
                Some("Local proxy has not started yet".to_string())
            };
            Ok(CliManagedProxyStatus {
                agent_name,
                supported: true,
                running,
                ready: running,
                url,
                selected_key_id: Some(context.key_id),
                selected_provider: Some(context.provider),
                selected_model: Some(context.model),
                upstream_base_url: Some(context.upstream_base_url),
                message,
            })
        }
        Err(err) => {
            let selection = agent_cli::managed_config::managed_selection_for_agent(&agent_name)?;
            Ok(CliManagedProxyStatus {
                agent_name,
                supported: true,
                running,
                ready: false,
                url,
                selected_key_id: selection
                    .as_ref()
                    .and_then(|selection| selection.selected_key_id.clone()),
                selected_provider: selection
                    .as_ref()
                    .and_then(|selection| selection.selected_provider.clone()),
                selected_model: selection
                    .as_ref()
                    .and_then(|selection| selection.selected_model.clone()),
                upstream_base_url: None,
                message: Some(err),
            })
        }
    }
}

fn json_error(status: StatusCode, message: String) -> Response<Body> {
    let body = serde_json::json!({
        "error": {
            "message": message,
            "type": "orgii_cli_managed_proxy_error",
        }
    });

    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| Response::new(Body::from("proxy error")))
}

#[allow(dead_code)]
fn response_id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{prefix}_{millis}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rewrites_placeholder_model() {
        let mut value = json!({
            "model": ORGII_CURRENT_MODEL,
            "input": "hello"
        });

        rewrite_model_field(&mut value, "gpt-5.1");

        assert_eq!(value["model"], "gpt-5.1");
    }

    #[test]
    fn inserts_missing_model() {
        let mut value = json!({
            "input": "hello"
        });

        rewrite_model_field(&mut value, "gpt-5.1");

        assert_eq!(value["model"], "gpt-5.1");
    }

    #[test]
    fn builds_upstream_url_without_double_slashes() {
        assert_eq!(
            build_upstream_url("https://api.openai.com/v1/", "/responses"),
            "https://api.openai.com/v1/responses"
        );
    }

    #[test]
    fn builds_anthropic_upstream_url_without_double_v1() {
        assert_eq!(
            build_anthropic_upstream_url("https://api.anthropic.com/v1", "v1/messages"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            build_anthropic_upstream_url("https://zenmux.ai/api/anthropic", "v1/messages"),
            "https://zenmux.ai/api/anthropic/v1/messages"
        );
    }
}
