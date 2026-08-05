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
    pub const INPUTS_INVALID: &str = "PM_ERR:ROUTINE_INPUTS_INVALID";
}

/// Substitute `{{ inputs.<name> }}` template markers (with or without
/// inner spaces) in root-work templates. Declarative only.
fn substitute_inputs(template: &str, inputs: &std::collections::BTreeMap<String, String>) -> String {
    let mut result = template.to_string();
    for (name, value) in inputs {
        for marker in [
            format!("{{{{ inputs.{} }}}}", name),
            format!("{{{{inputs.{}}}}}", name),
        ] {
            result = result.replace(&marker, value);
        }
    }
    result
}

#[derive(Debug)]
pub struct InvokedRun {
    pub run_id: String,
    pub root_short_id: String,
    /// step id -> generated child short id, in spec order.
    pub steps: Vec<(String, String)>,
}

/// `routine.invoke` (§12.2): snapshot the current revision, create the
/// RoutineRun, materialize the root WorkItem and one generated child per
/// step through the canonical `work.create` handler, and record the
/// dependency edges as durable `depends_on` relations. Scheduler and
/// manual invocations share this single entry point.
pub fn invoke(
    routine_name: &str,
    scope_project_slug: &str,
    inputs: &std::collections::BTreeMap<String, String>,
    created_by: Option<&crate::projects::types::WorkItemMutationActor>,
) -> Result<InvokedRun, String> {
    // 1. Load the current definition.
    let connection = project_io::helpers::conn()?;
    let (spec_json, spec_hash, revision): (String, String, i64) = connection
        .query_row(
            "SELECT spec_json, spec_hash, revision FROM pm_routines WHERE name = ?1",
            rusqlite::params![routine_name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => {
                format!("Routine '{}' not found", routine_name)
            }
            other => format!("routine invoke: {other}"),
        })?;
    drop(connection);
    let snapshot: spec::RoutineSpecFile =
        serde_json::from_str(&spec_json).map_err(|err| format!("snapshot parse: {err}"))?;

    // 2. Validate inputs against the snapshot's contract.
    for (name, decl) in &snapshot.spec.inputs {
        if decl.required && !inputs.contains_key(name) {
            return Err(format!("{}:missing required input '{}'", error::INPUTS_INVALID, name));
        }
    }
    for name in inputs.keys() {
        if !snapshot.spec.inputs.contains_key(name) {
            return Err(format!("{}:unknown input '{}'", error::INPUTS_INVALID, name));
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    let run_id = format!("run_{}{:05}", now, std::process::id() % 100_000);

    // 3. Materialize the work graph through the canonical create handler.
    let root_short_id = project_io::allocate_short_id(scope_project_slug)?;
    let root_request = work_service::CreateWorkItemRequest {
        title: substitute_inputs(&snapshot.spec.root_work.title, inputs),
        body: snapshot
            .spec
            .root_work
            .body
            .as_deref()
            .map(|body| substitute_inputs(body, inputs))
            .unwrap_or_default(),
        priority: snapshot.spec.root_work.priority.clone(),
        labels: snapshot.spec.root_work.labels.clone(),
        created_by: created_by.map(|actor| actor.id.clone()),
        ..Default::default()
    };
    work_service::create_project_work_item(scope_project_slug, &root_short_id, &root_request, created_by)?;

    let mut step_ids: Vec<(String, String)> = Vec::new();
    for step in &snapshot.spec.steps {
        let child_short_id = project_io::allocate_short_id(scope_project_slug)?;
        let mut body = step
            .instruction
            .as_deref()
            .map(|instruction| substitute_inputs(instruction, inputs))
            .unwrap_or_default();
        if !step.inputs.is_empty() {
            body.push_str("\n\n## Inputs\n");
            for (name, expression) in &step.inputs {
                body.push_str(&format!("- {}: {}\n", name, expression));
            }
        }
        if let Some(actor_requirement) = &step.actor {
            body.push_str(&format!(
                "\n## Actor requirement\n- role: {}\n- requires: {}\n",
                actor_requirement.role,
                actor_requirement.requires.join(", ")
            ));
        }
        let child_request = work_service::CreateWorkItemRequest {
            title: substitute_inputs(&step.title, inputs),
            body,
            parent: Some(root_short_id.clone()),
            created_by: created_by.map(|actor| actor.id.clone()),
            ..Default::default()
        };
        work_service::create_project_work_item(
            scope_project_slug,
            &child_short_id,
            &child_request,
            created_by,
        )?;
        step_ids.push((step.id.clone(), child_short_id));
    }

    // 4. Durable graph edges: dependencies + run provenance.
    let index: std::collections::HashMap<&str, &str> = step_ids
        .iter()
        .map(|(step_id, short_id)| (step_id.as_str(), short_id.as_str()))
        .collect();
    for step in &snapshot.spec.steps {
        let child = index[step.id.as_str()];
        for need in &step.needs {
            work_service::relate_project_work_item(
                scope_project_slug,
                child,
                "depends_on",
                &format!("work://{}/{}", scope_project_slug, index[need.as_str()]),
                created_by,
            )?;
        }
        work_service::relate_project_work_item(
            scope_project_slug,
            child,
            "generated_by",
            &format!("run://{}", run_id),
            created_by,
        )?;
    }

    // 5. The run row + audit, one transaction.
    let mut connection = project_io::helpers::conn()?;
    let tx = connection
        .transaction()
        .map_err(|err| format!("routine invoke tx: {err}"))?;
    tx.execute(
        "INSERT INTO pm_routine_runs
            (id, routine_name, routine_revision, snapshot_json, snapshot_hash,
             scope_id, status, inputs_json, root_work_item_id, created_by,
             created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7, ?8, ?9, ?10, ?10)",
        rusqlite::params![
            run_id,
            routine_name,
            revision,
            spec_json,
            spec_hash,
            scope_project_slug,
            serde_json::to_string(inputs).unwrap_or_default(),
            root_short_id,
            created_by.map(|actor| actor.id.as_str()),
            now,
        ],
    )
    .map_err(|err| format!("routine invoke: {err}"))?;
    let seq = work_service::audit::bump_change_seq(&tx)?;
    work_service::audit::append_audit_event(
        &tx,
        &work_service::audit::AuditEventRow {
            operation: "routine.invoke",
            entity_type: "routine_run",
            entity_id: &run_id,
            project_slug: Some(scope_project_slug),
            org_id: None,
            actor: created_by,
            revision,
            seq,
            payload: serde_json::json!({
                "routine": routine_name,
                "snapshotHash": spec_hash,
                "rootWorkItemId": root_short_id,
            }),
        },
    )?;
    tx.commit()
        .map_err(|err| format!("routine invoke commit: {err}"))?;

    Ok(InvokedRun {
        run_id,
        root_short_id,
        steps: step_ids,
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
