//! 容量在作品写入时记录；旧数据库仅补齐一次缺失值，之后统计完全来自 SQLite。
use super::metadata::{category_label, directory_size};
use super::models::{EhCategoryMetric, EhLibraryDashboard};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

static SIZE_BACKFILL: Mutex<()> = Mutex::new(());

pub(crate) fn backfill_missing_sizes(connection: &Connection) -> Result<(), String> {
    backfill_with(connection, directory_size)
}

fn backfill_with(connection: &Connection, measure: impl Fn(&Path) -> u64) -> Result<(), String> {
    let _guard = SIZE_BACKFILL.lock().map_err(|error| error.to_string())?;
    let pending = {
        let mut statement = connection
            .prepare("SELECT Gid,FolderPath FROM EhGalleries WHERE TotalBytes IS NULL")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for chunk in pending.chunks(64) {
        // 遍历目录时不持有 SQLite 写事务；每批短事务保存，可中断后继续补齐。
        let measured = chunk
            .iter()
            .map(|(gid, folder)| {
                (
                    *gid,
                    folder,
                    i64::try_from(measure(Path::new(folder))).unwrap_or(i64::MAX),
                )
            })
            .collect::<Vec<_>>();
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        for (gid, folder, bytes) in measured {
            // 同时扫描/下载可能已经更新容量或路径；旧补齐结果不得覆盖它们。
            transaction.execute("UPDATE EhGalleries SET TotalBytes=?1 WHERE Gid=?2 AND FolderPath=?3 AND TotalBytes IS NULL",
                params![bytes, gid, folder]).map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn read_dashboard(connection: &Connection) -> Result<EhLibraryDashboard, String> {
    let snapshot = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let (total_count, total_pages) = snapshot
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(Pages),0) FROM EhGalleries",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let mut statement = snapshot.prepare(
        "SELECT Category,COUNT(*),COALESCE(SUM(TotalBytes),0) FROM EhGalleries GROUP BY Category ORDER BY Category")
        .map_err(|error| error.to_string())?;
    let categories = statement
        .query_map([], |row| {
            let category = row.get(0)?;
            Ok(EhCategoryMetric {
                category,
                label: category_label(category),
                count: row.get(1)?,
                bytes: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    snapshot.commit().map_err(|error| error.to_string())?;
    Ok(EhLibraryDashboard {
        total_count,
        total_pages,
        total_bytes: categories.iter().map(|item| item.bytes).sum(),
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eh::database::{initialize_eh_schema, upsert_downloaded_gallery, upsert_gallery};
    use crate::eh::models::EhGallerySummary;
    use std::cell::Cell;

    fn gallery(gid: i64, folder: &Path) -> EhGallerySummary {
        serde_json::from_value(serde_json::json!({
            "gid":gid,"token":"","source":if gid<0 {"hitomi"} else {"eh"},"source_id":gid.abs().to_string(),
            "title":"fixture","category":if gid<0 {4} else {2},"artist":[],"group":[],"tags":[],
            "pages":2,"posted":"2020-01-01","cover_path":"","folder_path":folder.to_string_lossy()
        })).unwrap()
    }

    #[test]
    fn scan_download_retry_and_delete_update_cached_totals_for_both_sources() {
        let root = std::env::temp_dir().join(format!(
            "ero-stats-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let eh = root.join("eh");
        let hitomi = root.join("hitomi");
        std::fs::create_dir_all(&eh).unwrap();
        std::fs::create_dir_all(&hitomi).unwrap();
        let connection = Connection::open_in_memory().unwrap();
        initialize_eh_schema(&connection).unwrap();
        std::fs::write(eh.join("page.jpg"), [0; 100]).unwrap();
        std::fs::write(hitomi.join("page.webp"), [0; 200]).unwrap();
        upsert_gallery(&connection, &gallery(42, &eh)).unwrap();
        upsert_downloaded_gallery(&connection, &gallery(-42, &hitomi)).unwrap();
        assert_eq!(read_dashboard(&connection).unwrap().total_bytes, 300);
        std::fs::write(eh.join("page2.jpg"), [0; 50]).unwrap();
        assert_eq!(
            read_dashboard(&connection).unwrap().total_bytes,
            300,
            "reading statistics must not walk folders"
        );
        upsert_gallery(&connection, &gallery(42, &eh)).unwrap();
        assert_eq!(read_dashboard(&connection).unwrap().total_bytes, 350);
        std::fs::write(hitomi.join("page.webp"), [0; 250]).unwrap();
        upsert_downloaded_gallery(&connection, &gallery(-42, &hitomi)).unwrap();
        let dashboard = read_dashboard(&connection).unwrap();
        assert_eq!(dashboard.total_bytes, 400);
        assert_eq!(dashboard.total_count, 2);
        assert_eq!(dashboard.categories[1].bytes, 250);
        connection
            .execute("DELETE FROM EhGalleries WHERE Gid=-42", [])
            .unwrap();
        assert_eq!(read_dashboard(&connection).unwrap().total_bytes, 150);
        // Both paths are newly created test-only descendants of this unique temp root.
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn old_rows_are_backfilled_once_without_overwriting_a_concurrent_newer_size() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_eh_schema(&connection).unwrap();
        upsert_gallery(&connection, &gallery(42, Path::new("fixture-eh"))).unwrap();
        upsert_downloaded_gallery(&connection, &gallery(-42, Path::new("fixture-hitomi"))).unwrap();
        connection
            .execute(
                "UPDATE EhGalleries SET TotalBytes=NULL, AddedAt='2000-01-01'",
                [],
            )
            .unwrap();
        let calls = Cell::new(0);
        backfill_with(&connection, |folder| {
            calls.set(calls.get() + 1);
            if folder == Path::new("fixture-eh") {
                connection
                    .execute("UPDATE EhGalleries SET TotalBytes=300 WHERE Gid=42", [])
                    .unwrap();
            }
            100
        })
        .unwrap();
        assert_eq!(calls.get(), 2);
        assert_eq!(read_dashboard(&connection).unwrap().total_bytes, 400);
        backfill_with(&connection, |_| {
            panic!("already cached rows must never be traversed again")
        })
        .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT AddedAt FROM EhGalleries WHERE Gid=42", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "2000-01-01"
        );
    }
}
