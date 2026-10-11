//! Main media library domain.
//!
//! The submodules keep database access, metadata import, archive editing,
//! scanning, backup and duplicate detection behind one explicit boundary.

pub(crate) mod archive;
pub(crate) mod archive_cover;
pub(crate) mod archive_meta;
pub(crate) mod backup;
pub(crate) mod database;
pub(crate) mod delete;
pub(crate) mod duplicates;
pub(crate) mod favorites;
pub(crate) mod import;
pub(crate) mod inspection;
pub(crate) mod models;
pub(crate) mod portable;
pub(crate) mod query;
pub(crate) mod scan;
