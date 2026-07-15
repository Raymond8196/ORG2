//! Orgtrack Core
//!
//! Publishable core for collecting developer activity, writing canonical
//! records, projecting replay/stat views, and syncing repo-shareable `.orgtrack`
//! metadata. Host applications provide paths, permissions, UI commands, and
//! runtime-specific adapters.

pub mod activity_interaction;
pub mod canonical;
pub mod edit_extraction;
#[cfg(test)]
mod edit_extraction_tests;
pub mod hook_adapter;
pub mod policy;
pub mod privacy;
pub mod projectors;
pub mod repo_sync;
pub mod sources;
pub mod store;
pub mod sync_export;

pub use canonical::*;
pub use privacy::*;
pub use repo_sync::types::*;
