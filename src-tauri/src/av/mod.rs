//! AV 元数据获取、统一索引及本地资料存放。
mod catalog;
mod javdb_page;
mod models;
mod provider;
mod signature;
mod storage;
mod videos;
use crate::accounts::Session;
use crate::library::database::Database;
pub(crate) use catalog::initialize;
use catalog::{admit, settings};
pub use models::*;
#[cfg(test)]
use rusqlite::Connection;
use rusqlite::OptionalExtension;
static CATALOG_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub(crate) fn invalidate_inflight() {
    CATALOG_EPOCH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}
static OPERATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[tauri::command(async)]
pub fn av_get_settings(
    scope: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AvSettings, String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    state.authorize(&scope)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    settings(&conn)
}
#[tauri::command(async)]
pub fn av_bind_root(
    scope: String,
    root_path: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AvSettings, String> {
    let root = storage::root(&root_path)?;
    let _operation = OPERATIONS.lock().map_err(|e| e.to_string())?;
    {
        let state = session.0.lock().map_err(|e| e.to_string())?;
        state.authorize(&scope)?;
    }
    let works = storage::read_owned_root(&root)?;
    let state = session.0.lock().map_err(|e| e.to_string())?;
    state.authorize(&scope)?;
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    catalog::bind(&mut conn, &root, &works)
}
#[tauri::command(async)]
pub fn av_fetch_work(
    scope: String,
    code: String,
    queued_at: u64,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AvFetchResult, String> {
    let code = provider::normalize_code(&code)?;
    let _operation = OPERATIONS.lock().map_err(|e| e.to_string())?;
    let (root, admission, epoch) = {
        let state = session.0.lock().map_err(|e| e.to_string())?;
        state.authorize(&scope)?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let prior: Option<String> = conn
            .query_row(
                "SELECT MetaJson FROM AvWorks WHERE Code=?1",
                [&code],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let prior = prior
            .and_then(|json| serde_json::from_str::<AvWork>(&json).ok())
            .map(|work| work.queued_at)
            .filter(|value| !value.is_empty());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        let stamp = queued_at.min(now + 86_400_000).max(1) as i64;
        let admission = match prior {
            Some(value) => value,
            None => conn
                .query_row(
                    "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?1/1000.0, 'unixepoch')",
                    [stamp],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?,
        };
        (
            storage::root(&settings(&conn)?.root_path)?,
            admission,
            CATALOG_EPOCH.load(std::sync::atomic::Ordering::SeqCst),
        )
    };
    let mut work = provider::fetch_metadata(&code)?;
    work.queued_at = admission;
    let folder = storage::prepare(&root, &code)?;
    let warnings = storage::materialize(&mut work, &folder)?;
    work.videos = videos::list(&work.folder_path, &work.code);
    // 已授权的获取继续写入共享作品索引；锁定不打断下载，也不写任何个人偏好。
    // 前端另按发起 scope 丢弃旧账号的响应。整个流程不持会话/数据库锁等待网络。
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    if epoch != CATALOG_EPOCH.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("资料库已经恢复，请重新获取这部作品".into());
    }
    storage::save_metadata(&mut work)?;
    admit(&conn, &work)?;
    Ok(AvFetchResult { work, warnings })
}
#[tauri::command(async)]
pub fn av_add_magnet(
    scope: String,
    code: String,
    magnet: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AvWork, String> {
    change_magnet(scope, code, magnet, false, &db, &session)
}

#[tauri::command(async)]
pub fn av_remove_magnet(
    scope: String,
    code: String,
    magnet: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AvWork, String> {
    change_magnet(scope, code, magnet, true, &db, &session)
}

fn change_magnet(
    scope: String,
    code: String,
    magnet: String,
    remove: bool,
    db: &Database,
    session: &Session,
) -> Result<AvWork, String> {
    let code = provider::normalize_code(&code)?;
    let magnet = magnet.trim();
    if !magnet.starts_with("magnet:?")
        || magnet.len() > 8192
        || magnet.chars().any(|ch| ch.is_control())
    {
        return Err("请输入有效磁力链接".into());
    }
    let _operation = OPERATIONS.lock().map_err(|e| e.to_string())?;
    let state = session.0.lock().map_err(|e| e.to_string())?;
    state.authorize(&scope)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut work: AvWork = serde_json::from_str(
        &conn
            .query_row(
                "SELECT MetaJson FROM AvWorks WHERE Code=?1",
                [&code],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| "作品尚未建档")?,
    )
    .map_err(|e| e.to_string())?;
    let folder = storage::owned_folder(std::path::Path::new(&work.folder_path), &code)?;
    if folder.canonicalize().map_err(|e| e.to_string())?
        != std::path::Path::new(&work.folder_path)
            .canonicalize()
            .map_err(|e| e.to_string())?
    {
        return Err("作品目录与索引不一致".into());
    }
    if remove {
        storage::remove_magnet(&mut work, magnet)?;
    } else {
        if !work.magnets.iter().any(|value| value == magnet) {
            work.magnets.push(magnet.into());
        }
        storage::save_metadata(&mut work)?;
    }
    admit(&conn, &work)?;
    Ok(work)
}

#[tauri::command(async)]
pub fn av_list_works(
    scope: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<Vec<AvWork>, String> {
    // 授权与查询保持同一 session -> database 锁顺序，不在窗口消息线程等待。
    let mut works = {
        let state = session.0.lock().map_err(|e| e.to_string())?;
        state.authorize(&scope)?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        catalog::list_active(&conn)?
    };
    for work in &mut works {
        work.videos = videos::list(&work.folder_path, &work.code);
    }
    session
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .authorize(&scope)?;
    Ok(works)
}

#[tauri::command(async)]
pub fn av_get_local_videos(
    scope: String,
    code: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<Vec<AvVideo>, String> {
    let code = provider::normalize_code(&code)?;
    let folder = {
        let state = session.0.lock().map_err(|e| e.to_string())?;
        state.authorize(&scope)?;
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let json: String = conn
            .query_row(
                "SELECT MetaJson FROM AvWorks WHERE Code=?1",
                [&code],
                |row| row.get(0),
            )
            .map_err(|_| "作品尚未建档")?;
        serde_json::from_str::<AvWork>(&json)
            .map_err(|e| e.to_string())?
            .folder_path
    };
    let found = videos::list(&folder, &code);
    session
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .authorize(&scope)?;
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_json_without_modifying_existing_library_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE Works(Id INTEGER); INSERT INTO Works VALUES(42);")
            .unwrap();
        initialize(&conn).unwrap();
        initialize(&conn).unwrap();
        assert!(catalog::list_all(&conn).unwrap().is_empty());
        conn.execute("INSERT INTO AvWorks VALUES(?1,?2)", ["DEMO-100", r#"{"release_date":"2026-10-24","studio":"Studio A","tags":["sample"],"actresses":[{"id":"a","name":"Sample"}],"magnets":["magnet:?xt=sample"]}"#]).unwrap();
        let works = catalog::list_all(&conn).unwrap();
        assert_eq!(works[0].code, "DEMO-100");
        assert_eq!(works[0].actresses[0].name, "Sample");
        assert_eq!(works[0].magnets.len(), 1);
        assert_eq!(
            conn.query_row("SELECT Id FROM Works", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            42
        );
    }
}
