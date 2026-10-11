//! Small shared imports used by the backend modules.
//!
//! This is intentionally only a namespace for common third-party types. Business
//! models and commands remain owned by their respective modules.

pub(crate) use rusqlite::{params, Connection};
pub(crate) use tauri::State;
