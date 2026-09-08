//! Application lifecycle handlers wired into the Tauri builder: window events,
//! page loads, and the process-level run-event loop (including shutdown).

use tauri::Manager;

use crate::app::bootstrap::dev_startup_debug_enabled;

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "windows")]
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
static LAST_WEBVIEW_FOCUS_FORWARD_MS: AtomicU64 = AtomicU64::new(0);

/// Last time a REAL `WM_ACTIVATE(active)` reached the main window. tao's
/// `Focused(true)` fires for internal focus bounces too (the webview
/// relinquishing focus back to the parent emits no WM_ACTIVATE at all), so
/// only a fresh timestamp here proves an actual activation is in progress.
#[cfg(target_os = "windows")]
static LAST_REAL_ACTIVATION_MS: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "windows")]
fn unix_now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or(0)
}

#[cfg(target_os = "windows")]
static FOCUS_FORWARD_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Keeps the macOS traffic lights pinned after scale-factor, theme, and focus
/// changes.
pub(crate) fn sync_traffic_lights_on_window_event(
  _window: &tauri::Window,
  _event: &tauri::WindowEvent,
) {
  #[cfg(target_os = "macos")]
  match _event {
    tauri::WindowEvent::ScaleFactorChanged { .. }
    | tauri::WindowEvent::ThemeChanged(_)
    | tauri::WindowEvent::Focused(true) => {
      if let Some(webview_window) = _window.app_handle().get_webview_window(_window.label()) {
        app_window::set_traffic_light_position(
          &webview_window,
          app_window::TRAFFIC_LIGHT_X,
          app_window::TRAFFIC_LIGHT_Y,
        );
      }
    }
    _ => {}
  }
}

/// Windows: tauri hosts each webview as an HWND child of the tao window, so
/// wry never installs its parent `WM_SETFOCUS → MoveFocus` subclass (that
/// path is `!is_child` only). Alt+Tab therefore returns OS keyboard focus to
/// the parent window alone, and keystrokes are lost until something calls
/// `MoveFocus` into the WebView2 child.
///
/// Every attempt (immediate + bounded retries) is gated on a live win32
/// check of where keyboard focus actually sits: MoveFocus is issued only
/// while focus is NOT already inside this window's webview subtree. That
/// state gate — not a time window — keeps activation echoes from
/// multiplying into a focus ping-pong storm, which in turn lets the retry
/// ladder run long enough to outlast the wake-from-idle event-loop backlog
/// (observed ~1.1s) during which WebView2 silently drops MoveFocus calls
/// even though they report success.
pub(crate) fn forward_focus_to_webview_on_window_activation(
  window: &tauri::Window,
  event: &tauri::WindowEvent,
) {
  #[cfg(target_os = "windows")]
  if let tauri::WindowEvent::Focused(true) = event {
    // Echo guard: tao re-emits Focused(true) every time the webview bounces
    // keyboard focus back to the parent (~170ms cycle when the page has no
    // focusable element or the IME releases focus). Forwarding on those
    // echoes feeds a self-sustaining ping-pong — observed 3960 forwards over
    // 10.7 minutes from a single real activation, each bounce recompositing
    // the window edge (the user-visible "black line flicker"). A Focused(true)
    // that follows a real WM_ACTIVATE within this window is a genuine
    // activation echo and may forward; one with no recent WM_ACTIVATE is an
    // internal bounce and must be ignored.
    const ACTIVATION_FRESHNESS_MS: u64 = 2000;
    let now = unix_now_ms();
    let last_activation = LAST_REAL_ACTIVATION_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last_activation) > ACTIVATION_FRESHNESS_MS {
      return;
    }
    forward_focus_into_webview(window);
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (window, event);
  }
}

/// Shared forwarder for every activation trigger: tao's `Focused` event above
/// and the raw `WM_ACTIVATE` subclass installed by
/// `install_windows_alt_tab_focus_subclass` below.
#[cfg(target_os = "windows")]
fn forward_focus_into_webview(window: &tauri::Window) {
    // Dedupes only the Alt+Tab staging burst (explorer re-delivers
    // Focused(true) within ~100ms); storm prevention is activation-based
    // (see the echo guard above) plus this state gate.
    const FOCUS_FORWARD_DEDUPE_MS: u64 = 150;
    let now = unix_now_ms();
    let last = LAST_WEBVIEW_FOCUS_FORWARD_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < FOCUS_FORWARD_DEDUPE_MS {
      return;
    }
    LAST_WEBVIEW_FOCUS_FORWARD_MS.store(now, Ordering::Relaxed);
    let parent = match window.hwnd() {
      Ok(hwnd) => windows::Win32::Foundation::HWND(hwnd.0),
      Err(error) => {
        tracing::warn!(?error, "[FocusForward] no hwnd for window");
        return;
      }
    };
    if keyboard_focus_inside_webview(parent) {
      return;
    }
    // Only the window's primary webview: auxiliary child webviews (inline
    // browser panels, oauth popups) share this window, and MoveFocus to the
    // last-iterated one would strand keyboard focus in the wrong webview.
    let primary = window
      .webviews()
      .into_iter()
      .find(|webview| webview.label() == window.label());
    let Some(webview) = primary else {
      return;
    };
    tracing::debug!("[FocusForward] Focused(true) → forwarding now");
    if let Err(error) = webview.set_focus() {
      tracing::warn!(?error, "[FocusForward] immediate forward failed");
    }
    // Cumulative retry times: ~120/470/1270/2770ms. The ~1.3s rung exists
    // because MoveFocus calls issued during the wake-from-idle backlog are
    // dropped by WebView2 even though they report success; the ladder stops
    // the moment the state check sees focus inside the webview. The HWND
    // travels as an isize: the raw-pointer type itself is not `Send`, while
    // the handle value is meaningless outside this process.
    let parent_addr = parent.0 as isize;
    tauri::async_runtime::spawn(async move {
      for delay_ms in [120u64, 350, 800, 1500] {
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        if keyboard_focus_inside_webview(windows::Win32::Foundation::HWND(parent_addr as _)) {
          tracing::debug!(delay_ms, "[FocusForward] focus inside webview; ladder done");
          return;
        }
        if let Err(error) = webview.set_focus() {
          tracing::warn!(delay_ms, ?error, "[FocusForward] retry forward failed");
        } else {
          tracing::debug!(delay_ms, "[FocusForward] retry forward ok");
        }
      }
      tracing::info!("[FocusForward] ladder exhausted without confirmed focus");
    });
}

/// True when the foreground thread's keyboard focus sits on an HWND that is
/// a descendant of `parent` but not `parent` itself — i.e. on one of the
/// window's webview children, where nothing outside may move it.
#[cfg(target_os = "windows")]
fn keyboard_focus_inside_webview(parent: windows::Win32::Foundation::HWND) -> bool {
  use windows::Win32::Foundation::HWND;
  use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GA_ROOT,
    GUITHREADINFO,
  };

  unsafe {
    let foreground = GetForegroundWindow();
    if foreground.0.is_null() {
      return false;
    }
    let thread_id = GetWindowThreadProcessId(foreground, None);
    let mut info: GUITHREADINFO = std::mem::zeroed();
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if GetGUIThreadInfo(thread_id, &mut info).is_err() {
      return false;
    }
    let focus = info.hwndFocus;
    if focus.0.is_null() || focus.0 == parent.0 {
      return false;
    }
    let root: HWND = GetAncestor(focus, GA_ROOT);
    !root.0.is_null() && root.0 == parent.0
  }
}

/// tao derives `Focused(true)` from a `has_active_focus = is_active &&
/// is_focused` latch (tao window_state.rs). When Alt+Tab returns keyboard
/// focus to the parent window while that latch is already set — observed
/// after the webview child held focus across a deactivate/reactivate cycle —
/// no `Focused(true)` reaches tauri or the renderer at all and the forwarder
/// above never runs (probe: OS focus landed on the parent and stayed there;
/// backend and frontend logs show zero focus events for that activation). A
/// comctl32 subclass sees the raw `WM_ACTIVATE` for the main window
/// regardless of that bookkeeping and re-runs the same state-gated forward.
#[cfg(target_os = "windows")]
pub(crate) fn install_windows_alt_tab_focus_subclass(app: &tauri::AppHandle) {
  use windows::Win32::Foundation::HWND;
  use windows::Win32::UI::Shell::SetWindowSubclass;

  let _ = FOCUS_FORWARD_APP_HANDLE.set(app.clone());
  let Some(window) = app.get_window("main") else {
    tracing::warn!("[FocusForward] main window missing; activation subclass not installed");
    return;
  };
  let hwnd = match window.hwnd() {
    Ok(hwnd) => HWND(hwnd.0),
    Err(error) => {
      tracing::warn!(?error, "[FocusForward] no hwnd for main window");
      return;
    }
  };
  // The setup hook runs on the window-owning thread, as SetWindowSubclass
  // requires.
  let installed =
    unsafe { SetWindowSubclass(hwnd, Some(alt_tab_activation_subclass_proc), 0x46F5, 0) };
  if installed.as_bool() {
    tracing::info!("[FocusForward] WM_ACTIVATE subclass installed on main window");
  } else {
    tracing::warn!("[FocusForward] SetWindowSubclass failed for main window");
  }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn alt_tab_activation_subclass_proc(
  hwnd: windows::Win32::Foundation::HWND,
  msg: u32,
  wparam: windows::Win32::Foundation::WPARAM,
  lparam: windows::Win32::Foundation::LPARAM,
  _subclass_id: usize,
  _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
  use windows::Win32::UI::Shell::DefSubclassProc;
  use windows::Win32::UI::WindowsAndMessaging::{WA_INACTIVE, WM_ACTIVATE};

  if msg == WM_ACTIVATE && (wparam.0 as u32 & 0xFFFF) != WA_INACTIVE {
    if let Some(app) = FOCUS_FORWARD_APP_HANDLE.get() {
      let window = app
        .windows()
        .into_iter()
        .find(|(_label, candidate)| {
          candidate.hwnd().is_ok_and(|h| h.0 as isize == hwnd.0 as isize)
        })
        .map(|(_label, window)| window);
      if let Some(window) = window {
        // Mark the activation BEFORE forwarding: the tao Focused(true) echo
        // guard reads this timestamp to tell activation echoes (fresh) from
        // internal webview→parent focus bounces (stale).
        LAST_REAL_ACTIVATION_MS.store(unix_now_ms(), Ordering::Relaxed);
        tracing::debug!("[FocusForward] WM_ACTIVATE (active) → forward");
        forward_focus_into_webview(&window);
      }
    }
  }
  DefSubclassProc(hwnd, msg, wparam, lparam)
}

// Release keeps the historical behavior: closing the main window hides it so
// tray/dock entry points can reopen it. Debug Linux/Windows exits normally
// so dev runs do not leave hidden app processes behind.
pub(crate) fn handle_window_close_and_destroy(
    _window: &tauri::Window,
    _event: &tauri::WindowEvent,
) {
    // A destroyed window may never run its JS cleanup (crash, direct
    // programmatic close of a detached session window). Drop its
    // sleep-inhibitor holder so the process-wide assertion is
    // refcounted correctly — neither leaked until process exit nor
    // still attributed to a dead window.
    if let tauri::WindowEvent::Destroyed = _event {
        system_services::power::release_sleep_inhibitor_for_window_label(_window.label());
    }
    if let tauri::WindowEvent::CloseRequested { api: _api, .. } = _event {
        // Only hide the "main" window — let auxiliary windows close normally
        if _window.label() == "main" {
            #[cfg(any(target_os = "macos", not(debug_assertions)))]
            {
                _api.prevent_close();
                let _ = _window.hide();
            }
        }
    }
}

/// Main-webview page-load hook: dev startup tracing plus inline-webview
/// teardown on reload.
pub(crate) fn handle_page_load(
    webview: &tauri::Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    use tauri::webview::PageLoadEvent;
    if webview.label() == "main" {
        let event_label = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };
        if dev_startup_debug_enabled() {
            println!(
                "[TauriPageLoad] label={} event={} url={}",
                webview.label(),
                event_label,
                payload.url()
            );
            tracing::info!(
                label = webview.label(),
                event = event_label,
                url = %payload.url(),
                "[TauriPageLoad]"
            );
        }
    }
    if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Started) {
        let app = webview.app_handle().clone();
        match browser::inline::close_all_inline_webviews(app) {
            Ok(closed) if !closed.is_empty() => {
                tracing::info!(count = closed.len(), ?closed, "[PageReload] Closed inline webviews");
            }
            Err(err) => {
                tracing::warn!(error = %err, "[PageReload] Failed to close inline webviews");
            }
            _ => {}
        }
    }
}

/// Process-level run-event loop: macOS open/reopen behavior and the ordered
/// shutdown sequence on exit.
pub(crate) fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(not(target_os = "macos"))]
    let _ = &app_handle;

    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            tracing::info!(
                count = urls.len(),
                "[OpenedFiles] Ignoring native macOS open event"
            );
        }
        // macOS: clicking the dock icon when all windows are closed should reopen the main window
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Err(err) = app_window::recreate_main_window(app_handle) {
                    tracing::error!(error = %err, "[Reopen] Failed to recreate main window");
                }
            }
        }
        // Release keeps the process alive when all windows are hidden.
        // Debug Linux/Windows exits normally when the last window closes.
        // code.is_none() means it's an automatic exit (last window closed), not an explicit exit(0).
        tauri::RunEvent::ExitRequested {
            api: _api,
            code: _code,
            ..
        } => {
            #[cfg(any(target_os = "macos", not(debug_assertions)))]
            if _code.is_none() {
                _api.prevent_exit();
                return;
            }

            match agent_cli::managed_config::restore_managed_configs_for_shutdown() {
                Ok(report) => {
                    if !report.restored_agents.is_empty() {
                        tracing::info!(
                            agents = ?report.restored_agents,
                            "[CLI Managed Config] restored Default configs before exit"
                        );
                    }
                    for (agent, error) in report.failed_agents {
                        tracing::warn!(
                            agent,
                            error = %error,
                            "[CLI Managed Config] left config unchanged during exit"
                        );
                    }
                }
                Err(error) => tracing::warn!(
                    error = %error,
                    "[CLI Managed Config] failed to run shutdown restoration"
                ),
            }
            // Explicit exit — mark active orchestrator workflows as interrupted
            agent_core::coordination::work_item_recovery::mark_all_interrupted_sync();
            // Release computer-use lock if held
            integrations::computer_use_lock::force_release_on_exit();
            // Kill all PTY shells and (on Unix) their whole process
            // sessions — HUP-immune descendants would otherwise leak
            // past app exit.
            app_handle
                .state::<::terminal::pty_commands::pty::PtyState>()
                .shutdown_kill_all();
        }
        _ => {}
    }
}
