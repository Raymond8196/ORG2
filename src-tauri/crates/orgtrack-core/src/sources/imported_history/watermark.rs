//! Per-file parse watermarks for incremental transcript ingestion.
//!
//! A huge imported CLI transcript that keeps growing (a live session) changes
//! its `(mtime, size)` signature on every boot, which used to force a full
//! re-parse of the whole file each time. The watermark persists, per
//! `(source, source_session_id)`, the byte offset of the last COMPLETE line
//! already folded into the parser's accumulator, a fixed-size fingerprint at
//! that byte boundary, the source file identity, and the accumulator state
//! itself (`state_json`). A later parse resumes from the offset only when the
//! same file grew (or is byte-for-byte unchanged at the metadata level) and
//! the old boundary fingerprint still matches. This makes append validation
//! O(1) instead of re-reading and re-hashing the whole historical prefix.
//!
//! Only newline-terminated lines advance the watermark: a live writer may
//! still be appending to the final unterminated line, so its effects must
//! not be frozen into the persisted state (the parser feeds it into a
//! throwaway clone of the accumulator instead).

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
#[cfg(not(unix))]
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// A single JSONL record must fit within this many raw bytes (including its
/// trailing newline). The reader checks the bound before extending its buffer,
/// so malformed or hostile files cannot cause unbounded allocation.
pub const MAX_JSONL_LINE_BYTES: usize = 1024 * 1024;

/// Only a fixed window immediately before the committed offset is read when an
/// append is validated. File identity catches rotation; this boundary catches
/// truncate/rewrite-and-regrow at the append seam.
const BOUNDARY_WINDOW_BYTES: usize = 4096;
const BOUNDARY_FINGERPRINT_VERSION: u8 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedParseWatermark {
    pub byte_offset: i64,
    pub source_size_bytes: i64,
    /// Nanosecond mtime; see [`super::metadata::ImportedHistoryCacheInput::source_mtime_ms`].
    pub source_mtime_ms: i64,
    /// Versioned boundary fingerprint. The column name is retained for
    /// backwards-compatible persistence; legacy whole-prefix hashes simply
    /// fail decoding and trigger one cold re-parse.
    pub prefix_hash: String,
    pub parser_version: i64,
    pub state_json: String,
}

pub fn read_parse_watermark_from_conn(
    conn: &Connection,
    source: &str,
    source_session_id: &str,
) -> Result<Option<ImportedParseWatermark>, String> {
    let result = conn
        .query_row(
            "SELECT byte_offset, source_size_bytes, source_mtime_ms, prefix_hash,
                    parser_version, state_json
             FROM imported_history_parse_watermarks
             WHERE source = ?1 AND source_session_id = ?2",
            params![source, source_session_id],
            |row| {
                Ok(ImportedParseWatermark {
                    byte_offset: row.get(0)?,
                    source_size_bytes: row.get(1)?,
                    source_mtime_ms: row.get(2)?,
                    prefix_hash: row.get(3)?,
                    parser_version: row.get(4)?,
                    state_json: row.get(5)?,
                })
            },
        )
        .optional();
    match result {
        Ok(watermark) => Ok(watermark),
        Err(
            rusqlite::Error::InvalidColumnType(..)
            | rusqlite::Error::FromSqlConversionFailure(..)
            | rusqlite::Error::IntegralValueOutOfRange(..),
        ) => Ok(None),
        Err(err) => Err(format!("Failed to read imported parse watermark: {err}")),
    }
}

pub fn write_parse_watermark_from_conn(
    conn: &Connection,
    source: &str,
    source_session_id: &str,
    watermark: &ImportedParseWatermark,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO imported_history_parse_watermarks (
            source, source_session_id, byte_offset, source_size_bytes,
            source_mtime_ms, prefix_hash, parser_version, state_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            source,
            source_session_id,
            watermark.byte_offset,
            watermark.source_size_bytes,
            watermark.source_mtime_ms,
            watermark.prefix_hash,
            watermark.parser_version,
            watermark.state_json,
        ],
    )
    .map_err(|err| format!("Failed to write imported parse watermark: {err}"))?;
    Ok(())
}

pub fn clear_parse_watermark_from_conn(
    conn: &Connection,
    source: &str,
    source_session_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM imported_history_parse_watermarks
         WHERE source = ?1 AND source_session_id = ?2",
        params![source, source_session_id],
    )
    .map_err(|err| format!("Failed to clear imported parse watermark: {err}"))?;
    Ok(())
}

/// FNV-1a 64 used as a compact integrity check, not an adversarial digest.
#[derive(Debug, Clone)]
pub struct PrefixHasher(u64);

impl Default for PrefixHasher {
    fn default() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
}

impl PrefixHasher {
    pub fn update(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.0 ^= u64::from(byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    pub fn digest(&self) -> String {
        format!("{:016x}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct BoundaryFingerprint {
    version: u8,
    file_identity: String,
    tail_len: usize,
    tail_hash: String,
}

impl BoundaryFingerprint {
    fn new(file_identity: String, tail: &[u8]) -> Self {
        let mut hasher = PrefixHasher::default();
        hasher.update(tail);
        Self {
            version: BOUNDARY_FINGERPRINT_VERSION,
            file_identity,
            tail_len: tail.len(),
            tail_hash: hasher.digest(),
        }
    }

    fn decode(raw: &str) -> Option<Self> {
        let decoded = serde_json::from_str::<Self>(raw).ok()?;
        (decoded.version == BOUNDARY_FINGERPRINT_VERSION
            && !decoded.file_identity.is_empty()
            && decoded.tail_len <= BOUNDARY_WINDOW_BYTES)
            .then_some(decoded)
    }

    fn encode(&self) -> String {
        // This structure contains only integers and strings, so serialization
        // cannot fail in practice. An empty value safely disables resume.
        serde_json::to_string(self).unwrap_or_default()
    }
}

fn source_file_identity(path: &Path, metadata: &std::fs::Metadata) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
    }
    #[cfg(not(unix))]
    {
        // `created` is stable across appends and changes on normal rotation.
        // If the platform/filesystem cannot expose it, disable resume rather
        // than accepting an identity we cannot prove.
        let created_ns = metadata
            .created()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_nanos();
        let mut path_hasher = PrefixHasher::default();
        path_hasher.update(path.to_string_lossy().as_bytes());
        Some(format!(
            "created:{created_ns}:path:{}",
            path_hasher.digest()
        ))
    }
}

fn read_boundary_tail(file: &mut File, offset: u64) -> Result<Vec<u8>, String> {
    let tail_len = offset.min(BOUNDARY_WINDOW_BYTES as u64) as usize;
    let start = offset.saturating_sub(tail_len as u64);
    file.seek(SeekFrom::Start(start))
        .map_err(|err| format!("Failed to seek history boundary: {err}"))?;
    let mut tail = vec![0u8; tail_len];
    file.read_exact(&mut tail)
        .map_err(|err| format!("Failed to read history boundary: {err}"))?;
    Ok(tail)
}

fn push_boundary_bytes(window: &mut Vec<u8>, bytes: &[u8]) {
    if bytes.len() >= BOUNDARY_WINDOW_BYTES {
        window.clear();
        window.extend_from_slice(&bytes[bytes.len() - BOUNDARY_WINDOW_BYTES..]);
        return;
    }
    let overflow = window
        .len()
        .saturating_add(bytes.len())
        .saturating_sub(BOUNDARY_WINDOW_BYTES);
    if overflow > 0 {
        window.drain(..overflow);
    }
    window.extend_from_slice(bytes);
}

#[derive(Debug, PartialEq, Eq)]
pub struct TranscriptLine {
    pub text: String,
    /// `false` only for a final line with no trailing newline — a live
    /// writer may still be appending to it, so it must not advance the
    /// watermark or the persisted accumulator state.
    pub terminated: bool,
}

/// Line reader over one transcript that tracks the complete-line byte offset
/// and bounded append-boundary fingerprint, seeking past an intact watermark
/// prefix on open.
pub struct WatermarkedTranscriptReader {
    reader: BufReader<File>,
    file_identity: String,
    boundary_window: Vec<u8>,
    complete_offset: u64,
    resume_state_json: Option<String>,
    buf: Vec<u8>,
    error_label: &'static str,
}

impl WatermarkedTranscriptReader {
    pub fn open(
        path: &Path,
        error_label: &'static str,
        watermark: Option<&ImportedParseWatermark>,
        parser_version: i64,
        current_mtime_ns: i64,
        current_size_bytes: i64,
    ) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|err| {
            format!(
                "Failed to open {error_label} history {}: {err}",
                path.display()
            )
        })?;
        let metadata = file
            .metadata()
            .map_err(|err| format!("Failed to read {error_label} history metadata: {err}"))?;
        let file_len = metadata.len();
        let file_identity = source_file_identity(path, &metadata).unwrap_or_default();

        let mut boundary_window = Vec::new();
        let mut complete_offset = 0u64;
        let mut resume_state_json = None;
        if let Some(watermark) = watermark {
            let stored_fingerprint = BoundaryFingerprint::decode(&watermark.prefix_hash);
            let same_signature = current_size_bytes == watermark.source_size_bytes
                && current_mtime_ns == watermark.source_mtime_ms;
            let grew = current_size_bytes > watermark.source_size_bytes
                && current_mtime_ns >= watermark.source_mtime_ms;
            let eligible = watermark.parser_version == parser_version
                && watermark.byte_offset >= 0
                && (same_signature || grew)
                && watermark.byte_offset as u64 <= file_len
                && stored_fingerprint
                    .as_ref()
                    .is_some_and(|stored| stored.file_identity == file_identity);
            if eligible {
                let tail = read_boundary_tail(&mut file, watermark.byte_offset as u64)?;
                let current = BoundaryFingerprint::new(file_identity.clone(), tail.as_slice());
                if stored_fingerprint.as_ref() == Some(&current) {
                    complete_offset = watermark.byte_offset as u64;
                    boundary_window = tail;
                    resume_state_json = Some(watermark.state_json.clone());
                    file.seek(SeekFrom::Start(complete_offset))
                        .map_err(|err| format!("Failed to seek {error_label} history: {err}"))?;
                }
            }
            if resume_state_json.is_none() {
                boundary_window.clear();
                file.seek(SeekFrom::Start(0))
                    .map_err(|err| format!("Failed to rewind {error_label} history: {err}"))?;
            }
        }

        Ok(Self {
            reader: BufReader::new(file),
            file_identity,
            boundary_window,
            complete_offset,
            resume_state_json,
            buf: Vec::new(),
            error_label,
        })
    }

    pub fn resume_state_json(&self) -> Option<&str> {
        self.resume_state_json.as_deref()
    }

    pub fn next_line(&mut self) -> Result<Option<TranscriptLine>, String> {
        self.buf.clear();
        let mut terminated = false;
        loop {
            let available = self.reader.fill_buf().map_err(|err| {
                format!("Failed to read {} history line: {err}", self.error_label)
            })?;
            if available.is_empty() {
                break;
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let take = newline.map_or(available.len(), |index| index + 1);
            if self.buf.len().saturating_add(take) > MAX_JSONL_LINE_BYTES {
                return Err(format!(
                    "Failed to read {} history line: record exceeds {} bytes",
                    self.error_label, MAX_JSONL_LINE_BYTES
                ));
            }
            self.buf.extend_from_slice(&available[..take]);
            self.reader.consume(take);
            if newline.is_some() {
                terminated = true;
                break;
            }
        }
        if self.buf.is_empty() {
            return Ok(None);
        }
        if terminated {
            push_boundary_bytes(&mut self.boundary_window, &self.buf);
            self.complete_offset += self.buf.len() as u64;
        }
        let mut end = self.buf.len();
        if terminated {
            end -= 1;
            if end > 0 && self.buf[end - 1] == b'\r' {
                end -= 1;
            }
        }
        let text = std::str::from_utf8(&self.buf[..end])
            .map_err(|err| format!("Failed to read {} history line: {err}", self.error_label))?
            .to_string();
        Ok(Some(TranscriptLine { text, terminated }))
    }

    pub fn into_watermark(
        self,
        parser_version: i64,
        current_mtime_ns: i64,
        current_size_bytes: i64,
        state_json: String,
    ) -> ImportedParseWatermark {
        ImportedParseWatermark {
            byte_offset: self.complete_offset as i64,
            source_size_bytes: current_size_bytes,
            source_mtime_ms: current_mtime_ns,
            prefix_hash: BoundaryFingerprint::new(
                self.file_identity,
                self.boundary_window.as_slice(),
            )
            .encode(),
            parser_version,
            state_json,
        }
    }
}

#[cfg(test)]
#[path = "watermark_tests.rs"]
mod tests;
