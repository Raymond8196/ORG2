//! Shared payload limits for durable Agent Org state and inbox messages.
//!
//! These checks live at persistence boundaries as well as tool entry points:
//! an internal caller, migration, or future transport must not be able to
//! bypass the same resource contract the LLM-facing tools advertise.

pub const TASK_SUBJECT_MAX_CHARS: usize = 200;
pub const TASK_SUBJECT_MAX_BYTES: usize = TASK_SUBJECT_MAX_CHARS * 4;
pub const TASK_DESCRIPTION_MAX_CHARS: usize = 4_000;
pub const TASK_DESCRIPTION_MAX_BYTES: usize = TASK_DESCRIPTION_MAX_CHARS * 4;
/// Maximum description preview carried by paginated task summaries and the
/// frequently-polled Run View. Full durable descriptions remain available via
/// `task_get`.
pub const TASK_SUMMARY_DESCRIPTION_MAX_CHARS: usize = 512;
pub const TASK_SUMMARY_DEPENDENCY_PREVIEW_MAX_COUNT: usize = 8;
pub const TASK_SUMMARY_ELIGIBILITY_PREVIEW_MAX_COUNT: usize = 16;
pub const TASK_SUMMARY_ARTIFACT_PREVIEW_MAX_COUNT: usize = 16;
pub const TASK_SUMMARY_PAGE_MAX_BYTES: usize = 512 * 1024;
pub const TASK_OPEN_ID_PREVIEW_MAX_BYTES: usize = 16 * 1024;
pub const TASK_ACTIVE_FORM_MAX_CHARS: usize = 1_000;
pub const TASK_ACTIVE_FORM_MAX_BYTES: usize = TASK_ACTIVE_FORM_MAX_CHARS * 4;
pub const TASK_METADATA_MAX_BYTES: usize = 64 * 1024;
pub const TASK_REQUIRED_ROLE_MAX_CHARS: usize = 200;
pub const TASK_REQUIRED_ROLE_MAX_BYTES: usize = TASK_REQUIRED_ROLE_MAX_CHARS * 4;

pub const PLAIN_SUMMARY_MAX_CHARS: usize = 200;
pub const PLAIN_SUMMARY_MAX_BYTES: usize = PLAIN_SUMMARY_MAX_CHARS * 4;
pub const PLAIN_TEXT_MAX_CHARS: usize = 20_000;
pub const PLAIN_TEXT_MAX_BYTES: usize = PLAIN_TEXT_MAX_CHARS * 4;
pub const PLAN_FEEDBACK_MAX_CHARS: usize = 8_000;
pub const PLAN_FEEDBACK_MAX_BYTES: usize = PLAN_FEEDBACK_MAX_CHARS * 4;

pub const PLAN_TITLE_MAX_CHARS: usize = 200;
pub const PLAN_TITLE_MAX_BYTES: usize = PLAN_TITLE_MAX_CHARS * 4;
pub const PLAN_PATH_MAX_CHARS: usize = 4_096;
pub const PLAN_PATH_MAX_BYTES: usize = PLAN_PATH_MAX_CHARS * 4;
pub const PLAN_CONTENT_MAX_CHARS: usize = 200_000;
pub const PLAN_CONTENT_MAX_BYTES: usize = 256 * 1024;
pub const INLINE_PLAN_CONTENT_MAX_CHARS: usize = 20_000;
pub const INLINE_PLAN_CONTENT_MAX_BYTES: usize = INLINE_PLAN_CONTENT_MAX_CHARS * 4;

pub const TASK_OUTPUT_SUMMARY_MAX_CHARS: usize = 1_000;
pub const TASK_OUTPUT_SUMMARY_MAX_BYTES: usize = TASK_OUTPUT_SUMMARY_MAX_CHARS * 4;
pub const TASK_OUTPUT_CONTENT_MAX_CHARS: usize = 20_000;
pub const TASK_OUTPUT_CONTENT_MAX_BYTES: usize = TASK_OUTPUT_CONTENT_MAX_CHARS * 4;

pub const MEMBER_SUMMARY_MAX_CHARS: usize = 500;
pub const MEMBER_SUMMARY_MAX_BYTES: usize = MEMBER_SUMMARY_MAX_CHARS * 4;
pub const MEMBER_DISPLAY_NAME_MAX_CHARS: usize = 200;
pub const MEMBER_DISPLAY_NAME_MAX_BYTES: usize = MEMBER_DISPLAY_NAME_MAX_CHARS * 4;
pub const ASSIGNED_BY_MAX_CHARS: usize = 200;
pub const ASSIGNED_BY_MAX_BYTES: usize = ASSIGNED_BY_MAX_CHARS * 4;
pub const MEMBER_FAILURE_REASON_MAX_CHARS: usize = 4_000;
pub const MEMBER_FAILURE_REASON_MAX_BYTES: usize = MEMBER_FAILURE_REASON_MAX_CHARS * 4;
pub const EXEC_MODE_REASON_MAX_CHARS: usize = 500;
pub const EXEC_MODE_REASON_MAX_BYTES: usize = EXEC_MODE_REASON_MAX_CHARS * 4;
pub const SHUTDOWN_NOTE_MAX_CHARS: usize = 2_000;
pub const SHUTDOWN_NOTE_MAX_BYTES: usize = SHUTDOWN_NOTE_MAX_CHARS * 4;
pub const TASK_DEPENDENCY_OUTPUT_MAX_COUNT: usize = 64;
pub const TASK_DEPENDENCY_TOTAL_CONTENT_MAX_CHARS: usize = 50_000;
pub const TASK_DEPENDENCY_TOTAL_CONTENT_MAX_BYTES: usize =
    TASK_DEPENDENCY_TOTAL_CONTENT_MAX_CHARS * 4;
pub const AGENT_INBOX_PAYLOAD_MAX_BYTES: usize = 256 * 1024;

pub fn validate_text_len(
    field: &str,
    value: &str,
    max_chars: usize,
    max_bytes: usize,
) -> Result<(), String> {
    let byte_count = value.len();
    if byte_count > max_bytes {
        return Err(format!(
            "{field} must be <= {max_chars} chars and <= {max_bytes} bytes (got {byte_count} bytes)"
        ));
    }
    let char_count = value.chars().count();
    if char_count > max_chars {
        return Err(format!(
            "{field} must be <= {max_chars} chars and <= {max_bytes} bytes (got {char_count} chars)"
        ));
    }
    Ok(())
}

pub fn validate_required_text(
    field: &str,
    value: &str,
    max_chars: usize,
    max_bytes: usize,
) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    validate_text_len(field, value, max_chars, max_bytes)
}

pub fn validate_optional_text(
    field: &str,
    value: Option<&str>,
    max_chars: usize,
    max_bytes: usize,
) -> Result<(), String> {
    if let Some(value) = value {
        validate_text_len(field, value, max_chars, max_bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_count_unicode_chars_and_utf8_bytes() {
        assert!(validate_text_len("field", "你好", 2, 6).is_ok());
        assert!(validate_text_len("field", "你好呀", 2, 12)
            .unwrap_err()
            .contains("3 chars"));
        assert!(validate_text_len("field", "😀", 1, 3)
            .unwrap_err()
            .contains("4 bytes"));
    }
}
