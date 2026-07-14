//! ORG2 Cloud in-app webview windows (design §8).
//!
//! Opens managed-cloud web surfaces (login, billing) in an app-managed
//! `WebviewWindow` instead of the system browser, mirroring the Codex /
//! Gemini OAuth webview pattern. The login flow finishes with a top-level
//! navigation to `orgii://auth/callback#access_token=…`; we intercept that
//! navigation, forward the full URL to the frontend as the
//! `org2-cloud-auth-callback` event (same payload shape the deep-link path
//! parses), block the navigation so the OS never sees the custom scheme, and
//! close the window.
//!
//! Billing reuses the exact same window plumbing but is opened at a
//! pre-authenticated handoff URL (`/auth/callback?return_to=/billing#…tokens`)
//! that the frontend builds from the CURRENT desktop session, so the page
//! lands already signed-in without a second login — the web app's own
//! `/auth/callback` turns those fragment tokens into a browser cookie session
//! before continuing to `/billing` (design §8 / §18).

use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Window label for the login window — one at a time, replaced on re-click.
const LOGIN_WINDOW_LABEL: &str = "org2-cloud-login";

/// Window label for the billing window — one at a time, replaced on re-click.
const BILLING_WINDOW_LABEL: &str = "org2-cloud-billing";

/// The deep-link the login page redirects to when auth completes; matched on
/// the raw navigation URL inside our webview.
const AUTH_CALLBACK_PREFIX: &str = "orgii://auth/callback";

/// Event carrying `{ "url": "orgii://auth/callback#…" }` to the frontend.
const AUTH_CALLBACK_EVENT: &str = "org2-cloud-auth-callback";

/// The billing page navigates here after Stripe confirms the paid plan;
/// we notify the frontend (entitlement re-pull) and close the window.
const BILLING_COMPLETE_PREFIX: &str = "orgii://billing/complete";

/// Event telling the frontend a checkout completed inside the billing window.
const BILLING_COMPLETE_EVENT: &str = "org2-cloud-billing-complete";

/// Open `url` in an app-managed webview window under `label`.
///
/// `allowed_origin` is the CONFIGURED cloud web origin (official Vercel app or
/// the user's custom deployment, cloud-parity Phase C) — the frontend resolves
/// it from the same endpoint settings that produced `url`. This must not be an
/// open proxy for arbitrary windows: `allowed_origin` must be https and `url`
/// must sit on exactly that origin.
///
/// The navigation handler intercepts the `orgii://auth/callback` redirect
/// (used by the login flow, and by a billing window that had to re-auth) and
/// forwards it to the frontend, so any in-window sign-in still completes the
/// desktop session.
async fn open_cloud_web_window(
    app: AppHandle,
    url: String,
    allowed_origin: String,
    label: &'static str,
    title: &'static str,
) -> Result<(), String> {
    let allowed = Url::parse(&allowed_origin)
        .map_err(|err| format!("Invalid ORG2 Cloud origin {allowed_origin}: {err}"))?;
    if allowed.scheme() != "https" {
        return Err(format!(
            "Refusing non-https ORG2 Cloud origin: {allowed_origin}"
        ));
    }
    let target = Url::parse(&url).map_err(|err| format!("Invalid ORG2 Cloud URL: {err}"))?;
    if target.scheme() != "https" || target.origin() != allowed.origin() {
        return Err(format!(
            "Refusing to open URL outside the configured ORG2 Cloud origin: {url}"
        ));
    }

    // Replace any window left over from a previous attempt.
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.close();
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    let app_for_navigation = app.clone();
    // Deliberately NOT incognito, unlike the Codex/Gemini OAuth webviews:
    // those clear provider cookies for account hygiene (which ChatGPT/Google
    // account the CLI binds to matters), whereas ORG2 Cloud sign-in goes
    // through the user's own GitHub session — keeping cookies makes the common
    // case one-click instead of a full GitHub password prompt.
    let builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(target))
        .title(title)
        .inner_size(520.0, 680.0)
        // GitHub's top-level OAuth flow (github.com → supabase → vercel) never
        // needs a popup; deny anything that asks for one.
        .on_new_window(move |new_window_url, _features| {
            tracing::info!(url = %new_window_url, "[org2-cloud] popup denied");
            tauri::webview::NewWindowResponse::Deny
        })
        .on_navigation(move |navigation_url| {
            let url_value = navigation_url.to_string();
            if url_value.starts_with(AUTH_CALLBACK_PREFIX) {
                let _ = app_for_navigation
                    .emit(AUTH_CALLBACK_EVENT, serde_json::json!({ "url": url_value }));
                let app_for_async_close = app_for_navigation.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    if let Some(window) = app_for_async_close.get_webview_window(label) {
                        let _ = window.close();
                    }
                });
                // Block the navigation — the OS must not also try to handle the
                // orgii:// scheme (that would double-fire via the deep-link path).
                return false;
            }
            if url_value.starts_with(BILLING_COMPLETE_PREFIX) {
                // Checkout confirmed inside the billing window: tell the
                // frontend to re-pull entitlements, then close the window
                // (same delayed-close idiom as the auth callback).
                let _ = app_for_navigation.emit(BILLING_COMPLETE_EVENT, serde_json::json!({}));
                let app_for_async_close = app_for_navigation.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                    if let Some(window) = app_for_async_close.get_webview_window(label) {
                        let _ = window.close();
                    }
                });
                return false;
            }
            // Allow the whole https chain (vercel → supabase → github → …).
            true
        });

    builder
        .build()
        .map_err(|err| format!("Failed to open ORG2 Cloud window {label}: {err}"))?;

    Ok(())
}

/// Open the managed-cloud login page in an app-managed webview window.
#[tauri::command]
pub async fn org2_cloud_open_login(
    app: AppHandle,
    login_url: String,
    allowed_origin: String,
) -> Result<(), String> {
    open_cloud_web_window(
        app,
        login_url,
        allowed_origin,
        LOGIN_WINDOW_LABEL,
        "Sign in to ORG2 Cloud",
    )
    .await
}

/// Open the managed-cloud billing page in an app-managed webview window.
///
/// `billing_url` is the pre-authenticated handoff URL the frontend builds from
/// the current desktop session (`/auth/callback?return_to=/billing#…tokens`),
/// so the page lands signed-in without a second login. When the desktop is
/// signed out (or the session could not be refreshed) the frontend passes the
/// plain login URL instead, and the shared navigation handler still completes
/// the sign-in.
#[tauri::command]
pub async fn org2_cloud_open_billing(
    app: AppHandle,
    billing_url: String,
    allowed_origin: String,
) -> Result<(), String> {
    open_cloud_web_window(
        app,
        billing_url,
        allowed_origin,
        BILLING_WINDOW_LABEL,
        "ORG2 Cloud Billing",
    )
    .await
}
