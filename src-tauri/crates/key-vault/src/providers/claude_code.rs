use serde::Deserialize;
use std::time::Duration;

use crate::providers::quota_windows::{normalize_reset_time, quota_from_windows, QuotaWindow};
use crate::types::QuotaInfo;

const OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER: &str = "oauth-2025-04-20";
const CLAUDE_CODE_USER_AGENT: &str = "claude-code/2.1.0";
const DEFAULT_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Deserialize)]
struct OAuthUsageWindow {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthUsageResponse {
    five_hour: Option<OAuthUsageWindow>,
    seven_day: Option<OAuthUsageWindow>,
}

pub struct ClaudeCodeQuotaFetcher {
    client: reqwest::Client,
    timeout: Duration,
}

impl ClaudeCodeQuotaFetcher {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        }
    }

    pub async fn fetch_quota(&self, access_token: &str) -> Result<QuotaInfo, String> {
        let token = access_token.trim();
        if token.is_empty() {
            return Err("Claude Code OAuth access token is empty".to_string());
        }

        let response = self
            .client
            .get(OAUTH_USAGE_URL)
            .header("Authorization", format!("Bearer {token}"))
            .header("anthropic-beta", OAUTH_BETA_HEADER)
            .header("User-Agent", CLAUDE_CODE_USER_AGENT)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|err| format!("Claude Code OAuth usage request failed: {err}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("Claude Code OAuth usage body read failed: {err}"))?;

        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(format!(
                "Claude Code OAuth usage unauthorized: HTTP {}",
                status.as_u16()
            ));
        }
        if !status.is_success() {
            return Err(format!(
                "Claude Code OAuth usage failed: HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        parse_oauth_usage_response(&body)
    }
}

impl Default for ClaudeCodeQuotaFetcher {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_oauth_usage_response(body: &str) -> Result<QuotaInfo, String> {
    let response: OAuthUsageResponse = serde_json::from_str(body)
        .map_err(|err| format!("Claude Code OAuth usage parse failed: {err}"))?;
    Ok(quota_from_usage_response(response))
}

fn quota_from_usage_response(response: OAuthUsageResponse) -> QuotaInfo {
    let mut windows = Vec::new();

    if let Some(window) = response.five_hour {
        if let Some(utilization) = window.utilization {
            windows.push(QuotaWindow::session(
                utilization,
                window.resets_at.as_deref().and_then(normalize_reset_time),
            ));
        }
    }

    if let Some(window) = response.seven_day {
        if let Some(utilization) = window.utilization {
            windows.push(QuotaWindow::weekly(
                utilization,
                window.resets_at.as_deref().and_then(normalize_reset_time),
            ));
        }
    }

    quota_from_windows("claude_code", "oauth_usage", windows)
}

#[cfg(test)]
#[path = "claude_code_tests.rs"]
mod tests;
