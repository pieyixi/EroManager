//! Read-only overview, dashboard and gallery list queries.
use crate::eh::database::{eh_db_path, open_eh_db, read_eh_settings};
use crate::eh::metadata::{category_label, directory_size, localize_gallery};
use crate::eh::models::*;
use rusqlite::Connection;
use std::path::Path;
#[tauri::command]
pub fn eh_get_library_overview() -> Result<EhLibraryOverview, String> {
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let (total_count, total_pages) = connection
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(Pages),0) FROM EhGalleries",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    Ok(EhLibraryOverview {
        root_path: settings.root_path,
        database_path: eh_db_path().to_string_lossy().to_string(),
        total_count,
        total_pages,
    })
}

#[tauri::command]
pub async fn eh_get_library_dashboard() -> Result<EhLibraryDashboard, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let connection = open_eh_db()?;
        let (total_count, total_pages) = connection
            .query_row(
                "SELECT COUNT(*),COALESCE(SUM(Pages),0) FROM EhGalleries",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT Category,FolderPath FROM EhGalleries ORDER BY Category")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        let mut grouped = std::collections::BTreeMap::<i64, (i64, u64)>::new();
        for row in rows {
            let (category, folder_path) = row.map_err(|error| error.to_string())?;
            let bytes = directory_size(Path::new(&folder_path));
            let metric = grouped.entry(category).or_default();
            metric.0 += 1;
            metric.1 = metric.1.saturating_add(bytes);
        }
        let categories = grouped
            .into_iter()
            .map(|(category, (count, bytes))| EhCategoryMetric {
                category,
                label: category_label(category),
                count,
                bytes,
            })
            .collect::<Vec<_>>();
        Ok(EhLibraryDashboard {
            total_count,
            total_pages,
            total_bytes: categories.iter().map(|item| item.bytes).sum(),
            categories,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn eh_list_local_galleries() -> Result<Vec<EhGallerySummary>, String> {
    let connection = open_eh_db()?;
    list_local_galleries(&connection)
}

pub(crate) fn list_local_galleries(
    connection: &Connection,
) -> Result<Vec<EhGallerySummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,
                COALESCE(NULLIF(AddedAt,''),NULLIF(UpdatedAt,''),'') AS EffectiveAddedAt,
                CoverPath,FolderPath,Source,SourceId,Language
         FROM EhGalleries ORDER BY Posted DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    Ok(rows
        .filter_map(Result::ok)
        .map(|v| {
            localize_gallery(EhGallerySummary {
                gid: v.0,
                token: v.1,
                source: v.12,
                source_id: v.13,
                language: v.14,
                title: v.2,
                category: v.3,
                artist: serde_json::from_str(&v.4).unwrap_or_default(),
                group: serde_json::from_str(&v.5).unwrap_or_default(),
                tags: serde_json::from_str(&v.6).unwrap_or_default(),
                artist_display: Vec::new(),
                group_display: Vec::new(),
                tags_display: Vec::new(),
                pages: v.7,
                posted: v.8,
                added_at: v.9,
                cover_path: v.10,
                folder_path: v.11,
            })
        })
        .collect())
}
