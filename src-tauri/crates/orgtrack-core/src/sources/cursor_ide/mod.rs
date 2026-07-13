//! Cursor IDE session data — DB scanner, bubble history reader, and support modules.

pub const CURSORIDE_SESSION_PREFIX: &str = "cursoride-";

pub mod db;
pub mod history;

mod helpers;
mod io;
mod models;
mod summaries;
