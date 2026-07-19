//! Discovery + metadata parse: scan `~/.claude/projects/*/*.jsonl`, detect
//! changed transcripts, and parse each into cache metadata + per-round usage.

use super::*;

pub(super) fn sync_claude_code_history_cache(conn: &mut Connection) -> Result<(), String> {
    let mut discovered = discover_claude_code_history_records()?;
    // Managed (GUI-launched) sessions surface through their code_sessions
    // row; the imported twin goes unlistable. Folding the verdict into the
    // fingerprint re-parses a session whose managed status flips.
    let managed_ids = managed_mirror::managed_source_session_ids_from_conn(
        conn,
        SOURCE_CLAUDE_CODE,
        SOURCE_CLAUDE_CODE,
    )?;
    for record in &mut discovered {
        managed_mirror::append_managed_fingerprint(
            &mut record.source_fingerprint,
            managed_ids.contains(&record.source_session_id),
        );
    }
    let signatures = discovered
        .iter()
        .map(ImportedHistoryDiscoveredRecord::signature)
        .collect::<Vec<_>>();
    let changed = imported_cache::changed_records_from_conn(
        conn,
        SOURCE_CLAUDE_CODE,
        &discovered,
        |record| record.signature(),
    )?;
    let mut inputs = Vec::new();
    let mut rounds = Vec::new();
    let mut reparsed_ids = Vec::new();
    for record in changed {
        if let Some(mut meta) = parse_claude_session_meta(record)? {
            let is_managed_history_mirror = managed_ids.contains(&meta.source_session_id);
            reparsed_ids.push(meta.session_id.clone());
            rounds.append(&mut meta.rounds);
            let mut input = session_meta_to_cache_input(meta);
            input.listable = input.listable && !is_managed_history_mirror;
            inputs.push(input);
        }
    }
    imported_cache::sync_source_cache_from_conn(
        conn,
        SOURCE_CLAUDE_CODE,
        imported_cache::live_ids_from_signatures(&signatures),
        inputs,
    )?;
    imported_cache::write_session_rounds_from_conn(conn, &reparsed_ids, &rounds)?;
    // Context-window continuations rewrite the conversation into a new
    // session file with the same first-user-message uuid; keep only the
    // newest sibling of each family listable.
    imported_cache::demote_superseded_continuations_from_conn(conn, SOURCE_CLAUDE_CODE)?;
    Ok(())
}

fn discover_claude_code_history_records() -> Result<Vec<ImportedHistoryDiscoveredRecord>, String> {
    let mut records = Vec::new();
    for projects_dir in claude_projects_dirs()? {
        if projects_dir.is_dir() {
            let title_index = load_claude_session_titles_for_projects_dir(&projects_dir)?;
            let mut files = Vec::new();
            collect_claude_session_files(&projects_dir, &mut files)?;
            for file in files {
                let (source_mtime_ms, source_size_bytes) =
                    imported_paths::file_metadata_signature(&file.path, "Claude")?;
                records.push(ImportedHistoryDiscoveredRecord {
                    source_session_id: file.file_stem.clone(),
                    source_path: file.path,
                    source_record_key: file.file_stem.clone(),
                    source_mtime_ms,
                    source_size_bytes,
                    source_fingerprint: claude_source_fingerprint(&file.file_stem, &title_index),
                    parser_version: CLAUDE_CODE_METADATA_PARSER_VERSION,
                });
            }
        }
    }
    Ok(records)
}

pub(super) fn collect_claude_session_files(
    dir: &Path,
    out: &mut Vec<ClaudeCodeSessionFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("Failed to read Claude dir: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read Claude dir entry: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_claude_session_files(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "jsonl")
        {
            let Some(file_stem) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            out.push(ClaudeCodeSessionFile {
                file_stem: file_stem.to_string(),
                path,
            });
        }
    }
    Ok(())
}

fn load_claude_session_titles_for_projects_dir(
    projects_dir: &Path,
) -> Result<HashMap<String, ClaudeSessionTitle>, String> {
    let Some(root) = projects_dir.parent() else {
        return Ok(HashMap::new());
    };
    load_claude_session_titles(&root.join("sessions"))
}

fn load_claude_session_titles(
    sessions_dir: &Path,
) -> Result<HashMap<String, ClaudeSessionTitle>, String> {
    let mut entries = HashMap::new();
    if !sessions_dir.is_dir() {
        return Ok(entries);
    }

    for entry in fs::read_dir(sessions_dir)
        .map_err(|err| format!("Failed to read Claude sessions dir: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Failed to read Claude session entry: {err}"))?;
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let contents = fs::read_to_string(&path).map_err(|err| {
            format!(
                "Failed to read Claude session metadata {}: {err}",
                path.display()
            )
        })?;
        let parsed: ClaudeSessionMetadataFile = match serde_json::from_str(&contents) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let session_id = parsed.session_id.trim();
        let name = parsed.name.trim();
        if session_id.is_empty() || name.is_empty() {
            continue;
        }
        entries.insert(
            session_id.to_string(),
            ClaudeSessionTitle {
                name: name.to_string(),
                name_source: parsed.name_source,
            },
        );
    }

    Ok(entries)
}

fn claude_source_fingerprint(
    file_stem: &str,
    title_index: &HashMap<String, ClaudeSessionTitle>,
) -> String {
    title_index
        .get(file_stem)
        .map(|title| {
            format!(
                "session-meta:{}:{}",
                title.name_source.as_deref().unwrap_or_default(),
                title.name
            )
        })
        .unwrap_or_default()
}

fn claude_session_title_for_record(
    record: &ImportedHistoryDiscoveredRecord,
) -> Result<String, String> {
    let Some(sessions_dir) = claude_sessions_dir_for_session_path(&record.source_path) else {
        return Ok(String::new());
    };
    let title_index = load_claude_session_titles(&sessions_dir)?;
    Ok(title_index
        .get(&record.source_record_key)
        .map(|title| imported_history::truncate_name(&title.name, 200))
        .unwrap_or_default())
}

fn claude_sessions_dir_for_session_path(session_path: &Path) -> Option<PathBuf> {
    session_path.ancestors().find_map(|ancestor| {
        if ancestor.file_name().and_then(|name| name.to_str()) == Some("projects") {
            return ancestor.parent().map(|root| root.join("sessions"));
        }
        None
    })
}

pub(super) fn parse_claude_session_meta(
    record: &ImportedHistoryDiscoveredRecord,
) -> Result<Option<ClaudeCodeHistoryMeta>, String> {
    let file = fs::File::open(&record.source_path).map_err(|err| {
        format!(
            "Failed to open Claude history {}: {err}",
            record.source_path.display()
        )
    })?;
    let reader = BufReader::new(file);

    let mut created_at_ms = 0;
    let mut updated_at_ms = 0;
    let mut external_title = claude_session_title_for_record(record)?;
    let mut ai_title = String::new();
    let mut custom_title = String::new();
    let mut first_prompt = String::new();
    let mut model: Option<String> = None;
    let mut repo_path: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    let mut cache_read_tokens = 0;
    let mut cache_write_tokens = 0;
    let mut rounds: Vec<RoundUsage> = Vec::new();
    // One API response spans several assistant lines that repeat the same
    // `usage`; count each `message.id` once.
    let mut seen_message_ids: HashSet<String> = HashSet::new();
    // Primary impact source: exact counts from tool_use_result.structuredPatch.
    let mut impact = ImportedHistoryImpactStats::default();
    let mut touched_files = BTreeSet::new();
    // Fallback for transcripts old enough to lack structuredPatch: the coarse
    // old_string/new_string line count. Only used when no patch data is found.
    let mut fallback_impact = ImportedHistoryImpactStats::default();
    let mut fallback_touched = BTreeSet::new();
    // Subagent transcripts (`<parent-uuid>/subagents/agent-*.jsonl`) tag every
    // line `isSidechain: true` and carry the spawning session's UUID in
    // `sessionId`. Capturing it lets us subsume the child under its parent the
    // same way Codex does, instead of listing it as a top-level session.
    let mut parent_source_session_id: Option<String> = None;
    let mut first_user_uuid: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Claude history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: ClaudeJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let line_ms = parsed
            .timestamp
            .as_deref()
            .and_then(imported_history::parse_iso_to_epoch_ms_opt)
            .unwrap_or(0);
        if let Some(timestamp) = parsed
            .timestamp
            .as_deref()
            .and_then(imported_history::parse_iso_to_epoch_ms_opt)
        {
            if created_at_ms == 0 || timestamp < created_at_ms {
                created_at_ms = timestamp;
            }
            if timestamp > updated_at_ms {
                updated_at_ms = timestamp;
            }
        }
        if repo_path.is_none() && !parsed.cwd.trim().is_empty() {
            repo_path = Some(parsed.cwd.clone());
        }
        if branch.is_none() && !parsed.git_branch.trim().is_empty() {
            branch = Some(parsed.git_branch.clone());
        }
        // A sidechain line whose `sessionId` differs from this file's own stem
        // is a subagent pointing at its spawning session. Guard against a self
        // reference so a malformed line can never make a session its own parent.
        if parent_source_session_id.is_none() && parsed.is_sidechain {
            let candidate = parsed.session_id.trim();
            if !candidate.is_empty() && candidate != record.source_session_id {
                parent_source_session_id = Some(candidate.to_string());
            }
        }
        // Claude Code persists the session title inside the transcript. Titles are
        // re-emitted as the conversation evolves, so the last write wins.
        match parsed.r#type.as_str() {
            "summary" if external_title.is_empty() => {
                let summary = parsed.summary.trim();
                if !summary.is_empty() {
                    external_title = imported_history::truncate_name(summary, 200);
                }
            }
            "ai-title" => {
                let title = parsed.ai_title.trim();
                if !title.is_empty() {
                    ai_title = imported_history::truncate_name(title, 200);
                }
            }
            "custom-title" => {
                let title = parsed.custom_title.trim();
                if !title.is_empty() {
                    custom_title = imported_history::truncate_name(title, 200);
                }
            }
            _ => {}
        }
        // Exact diff stats come from the tool-result's structuredPatch.
        if let Some(result) = parsed.tool_use_result.as_ref() {
            collect_claude_impact_from_tool_result(result, &mut impact, &mut touched_files);
        }
        if first_user_uuid.is_none() && parsed.r#type == "user" && !parsed.uuid.trim().is_empty() {
            first_user_uuid = Some(parsed.uuid.trim().to_string());
        }
        if let Some(message) = parsed.message {
            if first_prompt.is_empty() && parsed.r#type == "user" {
                if let Some(text) = claude_content_text(&message.content) {
                    // GUI-launched runs prefix the first prompt with the
                    // exec-mode briefing; bridge-only text is no title
                    // candidate at all.
                    let text = imported_history::strip_orgii_exec_mode_bridge(&text);
                    if !text.trim().is_empty() {
                        first_prompt = imported_history::truncate_name(text, 200);
                    }
                }
            }
            if model.is_none()
                && !message.model.trim().is_empty()
                && !message.model.starts_with('<')
            {
                model = Some(message.model.clone());
            }
            if parsed.r#type == "assistant" {
                for item in claude_content_items(&message.content) {
                    collect_claude_impact_from_item(
                        item,
                        &mut fallback_impact,
                        &mut fallback_touched,
                    );
                }
            }
            // Skip repeated lines of the same API response (same message.id),
            // which would otherwise triple both totals and rounds.
            let usage_is_new = message.id.is_empty() || seen_message_ids.insert(message.id.clone());
            if let Some(usage) = message.usage.filter(|_| usage_is_new) {
                // input_tokens stays cache-inclusive (fresh + both cache kinds);
                // the cache portion is tracked separately for the cost split.
                input_tokens += usage.input_tokens
                    + usage.cache_read_input_tokens
                    + usage.cache_creation_input_tokens;
                output_tokens += usage.output_tokens;
                cache_read_tokens += usage.cache_read_input_tokens;
                cache_write_tokens += usage.cache_creation_input_tokens;
                // One round per assistant message that reports usage. `input`
                // here is FRESH (round convention), cache tracked separately.
                if usage.input_tokens > 0
                    || usage.output_tokens > 0
                    || usage.cache_read_input_tokens > 0
                    || usage.cache_creation_input_tokens > 0
                {
                    rounds.push(RoundUsage {
                        source: SOURCE_CLAUDE_CODE,
                        source_session_id: record.source_session_id.clone(),
                        session_id: super::canonical_session_id(&record.source_session_id),
                        seq: rounds.len() as i64,
                        model: model.clone(),
                        input_tokens: usage.input_tokens,
                        output_tokens: usage.output_tokens,
                        cache_read_tokens: usage.cache_read_input_tokens,
                        cache_write_tokens: usage.cache_creation_input_tokens,
                        created_at_ms: line_ms,
                    });
                }
            }
        }
    }

    // Prefer the precise structuredPatch counts; fall back to the coarse
    // old_string/new_string heuristic only when no patch data was present.
    if touched_files.is_empty() && impact.lines_added == 0 && impact.lines_removed == 0 {
        impact = fallback_impact;
        touched_files = fallback_touched;
    }

    impact.touched_files = touched_files.into_iter().collect();
    impact.files_changed = impact.touched_files.len() as i64;

    if created_at_ms == 0 && record.source_mtime_ms == 0 {
        return Ok(None);
    }

    Ok(Some(ClaudeCodeHistoryMeta {
        source_session_id: record.source_session_id.clone(),
        session_id: super::canonical_session_id(&record.source_session_id),
        source_path: record.source_path.to_string_lossy().to_string(),
        source_record_key: record.source_record_key.clone(),
        source_mtime_ms: record.source_mtime_ms,
        source_size_bytes: record.source_size_bytes,
        source_fingerprint: record.source_fingerprint.clone(),
        // Mirror the Claude Code app's own precedence: a user-set custom title
        // wins, then the AI-generated title, then the derived/summary title,
        // then the first prompt, and finally the raw session id.
        name: if !custom_title.is_empty() {
            custom_title
        } else if !ai_title.is_empty() {
            ai_title
        } else if !external_title.is_empty() {
            external_title
        } else if !first_prompt.is_empty() {
            first_prompt
        } else {
            record.source_record_key.clone()
        },
        created_at_ms: if created_at_ms > 0 {
            created_at_ms
        } else {
            record.source_mtime_ms
        },
        updated_at_ms: if updated_at_ms > 0 {
            updated_at_ms
        } else {
            record.source_mtime_ms
        },
        model,
        repo_path,
        branch,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        rounds,
        impact,
        parent_session_id: parent_source_session_id
            .map(|uuid| format!("{CLAUDE_CODE_SESSION_PREFIX}{uuid}")),
        first_user_uuid,
    }))
}

pub(super) fn session_meta_to_cache_input(meta: ClaudeCodeHistoryMeta) -> ImportedHistoryCacheInput {
    ImportedHistoryCacheInput {
        source: SOURCE_CLAUDE_CODE,
        source_session_id: meta.source_session_id,
        session_id: meta.session_id,
        source_path: meta.source_path,
        source_record_key: meta.source_record_key,
        source_mtime_ms: meta.source_mtime_ms,
        source_size_bytes: meta.source_size_bytes,
        source_fingerprint: meta.source_fingerprint,
        parser_version: CLAUDE_CODE_METADATA_PARSER_VERSION,
        name: meta.name,
        created_at_ms: meta.created_at_ms,
        updated_at_ms: meta.updated_at_ms,
        model: meta.model,
        input_tokens: meta.input_tokens,
        output_tokens: meta.output_tokens,
        cache_read_tokens: meta.cache_read_tokens,
        cache_write_tokens: meta.cache_write_tokens,
        repo_path: meta.repo_path,
        branch: meta.branch,
        impact: meta.impact,
        listable: true,
        source_metadata_json: imported_cache::continuation_group_metadata_json(
            meta.first_user_uuid.as_deref(),
        ),
        parent_session_id: meta.parent_session_id,
    }
}

/// Accumulate exact diff stats from a tool result's `structuredPatch`.
///
/// Claude Code attaches a `toolUseResult` sidecar to Edit/MultiEdit/Write tool
/// results containing a unified-diff-style `structuredPatch`. Each hunk's `lines`
/// are prefixed with `+` (added), `-` (removed), or ` ` (context), so this yields
/// the same counts a `git diff` would — unlike the old_string/new_string heuristic.
fn collect_claude_impact_from_tool_result(
    result: &Value,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    let Some(hunks) = result.get("structuredPatch").and_then(Value::as_array) else {
        return;
    };
    if let Some(file_path) = result
        .get("filePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        touched_files.insert(file_path.to_string());
    }
    for hunk in hunks {
        let Some(lines) = hunk.get("lines").and_then(Value::as_array) else {
            continue;
        };
        for line in lines {
            match line.as_str().and_then(|text| text.as_bytes().first()) {
                Some(b'+') => impact.lines_added += 1,
                Some(b'-') => impact.lines_removed += 1,
                _ => {}
            }
        }
    }
}

fn collect_claude_impact_from_item(
    item: &Value,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    if item.get("type").and_then(Value::as_str) != Some("tool_use") {
        return;
    }
    let Some(tool_name) = item.get("name").and_then(Value::as_str) else {
        return;
    };
    if !matches!(tool_name, "Edit" | "MultiEdit" | "Write") {
        return;
    }
    let Some(input) = item.get("input") else {
        return;
    };
    let Some(file_path) = input
        .get("file_path")
        .and_then(Value::as_str)
        .or_else(|| input.get("path").and_then(Value::as_str))
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return;
    };
    touched_files.insert(file_path.to_string());
    match tool_name {
        "Write" => {
            if let Some(content) = input.get("content").and_then(Value::as_str) {
                impact.lines_added += count_text_lines(content);
            }
        }
        "Edit" => {
            accumulate_claude_edit_input(input, impact);
        }
        "MultiEdit" => {
            if let Some(edits) = input.get("edits").and_then(Value::as_array) {
                for edit in edits {
                    accumulate_claude_edit_input(edit, impact);
                }
            }
        }
        _ => {}
    }
}

fn accumulate_claude_edit_input(input: &Value, impact: &mut ImportedHistoryImpactStats) {
    if let Some(old_string) = input.get("old_string").and_then(Value::as_str) {
        impact.lines_removed += count_text_lines(old_string);
    }
    if let Some(new_string) = input.get("new_string").and_then(Value::as_str) {
        impact.lines_added += count_text_lines(new_string);
    }
}

fn count_text_lines(text: &str) -> i64 {
    if text.is_empty() {
        0
    } else {
        text.lines().count() as i64
    }
}
