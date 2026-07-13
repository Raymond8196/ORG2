//! Trae (ByteDance) imported history reader.
//!
//! Trae stores a per-session "memory" record locally at
//! `~/.trae-cn/memory/projects/<slug>/<YYYYMMDD>/session_memory_<id>.jsonl`
//! (the verbatim transcript lives server-side). Each JSONL line is a turn
//! summary — `{intent, actions, outcome, learned, message_summary_time}` — and
//! a sibling `topics.md` holds a readable per-session summary used as the title.
pub mod history;
