//! Routine application service (`orgtrack/v1` Phase 4).
//!
//! Owns the portable Routine domain: spec validation/canonicalization
//! ([`spec`]), versioned definitions with immutable per-run snapshots,
//! and RoutineRun materialization into generated WorkItems through the
//! same `work.create` handler every other entry point uses.
//!
//! Storage: `pm_routines` (current definition + revision) and
//! `pm_routine_runs` (immutable occurrence: revision, snapshot, hash,
//! status projection inputs). The legacy `routine_definitions` /
//! `routine_fires` tables stay readable until the Phase 4 conversion
//! completes; conversion is one-way and disables definitions it cannot
//! express portably, with a written report.

pub mod spec;

use crate::projects::io as project_io;
use crate::work_service;

/// Compute the immutable snapshot hash for a canonical spec body.
pub fn snapshot_hash(canonical: &str) -> String {
    // FNV-1a 64 over the canonical bytes, doubled for width. Not
    // cryptographic — the hash pins run provenance, it does not defend
    // against adversaries; swap for sha256 when a crypto dep lands in
    // this crate for other reasons.
    fn fnv1a(bytes: &[u8], seed: u64) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325u64 ^ seed;
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
        }
        hash
    }
    let a = fnv1a(canonical.as_bytes(), 0);
    let b = fnv1a(canonical.as_bytes(), 0x9E37_79B9_7F4A_7C15);
    format!("fnv1a:{a:016x}{b:016x}")
}

/// `routine.apply` (§12.1): validate, canonicalize, then create or bump
/// the definition. Same canonical body → same revision (idempotent);
/// changed body → revision + 1. Historic runs are never touched.
pub fn apply(spec_file: &spec::RoutineSpecFile) -> Result<AppliedRoutine, String> {
    let violations = spec::validate(spec_file);
    if !violations.is_empty() {
        let details = serde_json::to_string(&violations).unwrap_or_default();
        return Err(format!("{}:{}", error::SPEC_INVALID, details));
    }
    let canonical = spec::canonicalize(spec_file)?;
    let hash = snapshot_hash(&canonical);

    let mut connection = project_io::helpers::conn()?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("routine apply tx: {err}"))?;

    let existing: Option<(i64, String)> = tx
        .query_row(
            "SELECT revision, spec_hash FROM pm_routines WHERE name = ?1",
            rusqlite::params![spec_file.metadata.name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(format!("routine apply: {other}")),
        })?;

    let (revision, changed) = match existing {
        Some((revision, ref stored_hash)) if stored_hash == &hash => (revision, false),
        Some((revision, _)) => {
            let next = revision + 1;
            tx.execute(
                "UPDATE pm_routines
                 SET spec_json = ?2, spec_hash = ?3, revision = ?4, updated_at = ?5
                 WHERE name = ?1",
                rusqlite::params![
                    spec_file.metadata.name,
                    canonical,
                    hash,
                    next,
                    chrono::Utc::now().timestamp_millis(),
                ],
            )
            .map_err(|err| format!("routine apply: {err}"))?;
            (next, true)
        }
        None => {
            tx.execute(
                "INSERT INTO pm_routines
                    (name, routine_id, spec_json, spec_hash, revision, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, 1, ?5, ?5)",
                rusqlite::params![
                    spec_file.metadata.name,
                    spec_file.metadata.id,
                    canonical,
                    hash,
                    chrono::Utc::now().timestamp_millis(),
                ],
            )
            .map_err(|err| format!("routine apply: {err}"))?;
            (1, true)
        }
    };

    if changed {
        let seq = work_service::audit::bump_change_seq(&tx)?;
        work_service::audit::append_audit_event(
            &tx,
            &work_service::audit::AuditEventRow {
                operation: "routine.apply",
                entity_type: "routine",
                entity_id: &spec_file.metadata.name,
                project_slug: None,
                org_id: None,
                actor: None,
                revision,
                seq,
                payload: serde_json::json!({ "specHash": hash }),
            },
        )?;
    }
    tx.commit()
        .map_err(|err| format!("routine apply commit: {err}"))?;

    Ok(AppliedRoutine {
        name: spec_file.metadata.name.clone(),
        revision,
        spec_hash: hash,
        changed,
    })
}

#[derive(Debug)]
pub struct AppliedRoutine {
    pub name: String,
    pub revision: i64,
    pub spec_hash: String,
    pub changed: bool,
}

/// Typed error sentinels for the routine domain.
pub mod error {
    pub const SPEC_INVALID: &str = "PM_ERR:ROUTINE_SPEC_INVALID";
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
