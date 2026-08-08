//! Project-session root WorkItem bootstrap (orgtrack/v1 §7.2).
//!
//! A Project session that has no active WorkItem gets its root created
//! when the first non-empty user submission is accepted — not when the
//! mode is switched and not when an empty session is opened. The
//! creation boundary is this host event; no LLM classification is
//! involved. The root's body preserves the original user request
//! verbatim (the derived short title never replaces it), and the
//! operation runs under a `(sessionRef)`-derived idempotency key so a
//! retried first submission cannot produce a duplicate root: if an
//! earlier attempt created the item but failed to link it, the replay
//! returns the stored short id and only the link is re-applied.

/// Best-effort bootstrap called from the message-accept path. Failures
/// are logged, never turned into a turn error — a broken PM store must
/// not take chat down with it.
pub(super) async fn ensure_project_root_work_item(session_id: &str, content: &str) {
    if content.trim().is_empty() {
        return;
    }
    let sid = session_id.to_string();
    let body = content.to_string();
    let joined =
        tokio::task::spawn_blocking(move || bootstrap_root_work_item(&sid, &body)).await;
    match joined {
        Ok(Ok(Some(short_id))) => {
            tracing::info!(
                session_id,
                short_id,
                "[project-bootstrap] created and linked root work item"
            );
        }
        Ok(Ok(None)) => {}
        Ok(Err(err)) => {
            tracing::warn!(session_id, error = %err, "[project-bootstrap] failed");
        }
        Err(err) => {
            tracing::warn!(session_id, error = %err, "[project-bootstrap] worker failed");
        }
    }
}

/// Blocking core, also driven directly by the `Track this` command —
/// there the "first accepted submission" already happened, so the root
/// is created from the recorded user input at conversion time.
pub(crate) fn bootstrap_root_work_item(
    session_id: &str,
    content: &str,
) -> Result<Option<String>, String> {
    let record = crate::session::persistence::get_session(session_id)
        .map_err(|err| format!("load session record: {err}"))?;
    let Some(record) = record else {
        return Ok(None);
    };
    if record.product_mode.as_deref() != Some("project") || record.work_item_id.is_some() {
        return Ok(None);
    }

    let short_id = project_management::work_service::bootstrap_root_standalone_item(
        session_id,
        record.org_id.as_deref(),
        content,
    )?;

    crate::session::persistence::link_bootstrap_work_item(session_id, &short_id)
        .map_err(|err| format!("link bootstrap work item: {err}"))?;
    Ok(Some(short_id))
}
