//! Value/timestamp helpers shared across the Warp history submodules.

use super::*;

pub(super) fn field<'a>(value: &'a Value, names: &[&str]) -> Option<&'a Value> {
    let object = value.as_object()?;
    names.iter().find_map(|name| object.get(*name))
}

pub(super) fn field_str<'a>(value: &'a Value, names: &[&str]) -> Option<&'a str> {
    field(value, names).and_then(Value::as_str)
}

pub(super) fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn line_count(value: &str) -> i64 {
    if value.is_empty() {
        0
    } else {
        value.lines().count() as i64
    }
}

pub(super) fn camel_to_snake(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 4);
    for (index, ch) in value.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if index > 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

pub(super) fn timestamp_value_to_iso(value: &Value) -> Option<String> {
    if let Some(raw) = value.as_str() {
        return Some(imported_history::normalize_created_at(raw));
    }
    let seconds = field(value, &["seconds"])?;
    let seconds = seconds
        .as_i64()
        .or_else(|| seconds.as_str().and_then(|raw| raw.parse().ok()))?;
    let nanos = field(value, &["nanos"])
        .and_then(Value::as_i64)
        .unwrap_or_default();
    chrono::DateTime::from_timestamp(seconds, nanos.max(0) as u32).map(|dt| dt.to_rfc3339())
}

pub(super) fn timestamp_value_to_epoch_ms(value: &Value) -> Option<i64> {
    timestamp_value_to_iso(value)
        .as_deref()
        .and_then(imported_history::parse_iso_to_epoch_ms_opt)
}

pub(super) fn parse_warp_timestamp_ms(value: &str) -> Option<i64> {
    imported_history::parse_iso_to_epoch_ms_opt(value).or_else(|| {
        ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M:%S"]
            .iter()
            .find_map(|format| NaiveDateTime::parse_from_str(value, format).ok())
            .map(|dt| dt.and_utc().timestamp_millis())
    })
}
