use crate::library::database::Database;
use crate::shared::{params, State};

fn delete_work_record(conn: &mut rusqlite::Connection, work_id: i64) -> Result<bool, String> {
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute(
            "DELETE FROM LibrarySnapshots WHERE WorkId = ?1",
            params![work_id],
        )
        .map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM WorkTags WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM Episodes WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    let deleted = transaction
        .execute("DELETE FROM Works WHERE Id = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(deleted > 0)
}

#[tauri::command]
pub fn delete_work(work_id: i64, db: State<Database>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    delete_work_record(&mut conn, work_id)?
        .then_some(())
        .ok_or_else(|| "数据库中不存在该作品".to_string())
}

#[cfg(test)]
mod tests {
    use super::delete_work_record;
    use rusqlite::Connection;

    #[test]
    fn removes_only_selected_database_graph() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE Works (Id INTEGER PRIMARY KEY, Title TEXT NOT NULL); CREATE TABLE Episodes (Id INTEGER PRIMARY KEY, WorkId INTEGER NOT NULL); CREATE TABLE WorkTags (WorkId INTEGER NOT NULL, TagId INTEGER NOT NULL); CREATE TABLE LibrarySnapshots (WorkId INTEGER PRIMARY KEY, MetaSignature TEXT NOT NULL); INSERT INTO Works VALUES (1, 'removed'), (2, 'kept'); INSERT INTO Episodes VALUES (10, 1), (20, 2); INSERT INTO WorkTags VALUES (1, 100), (2, 200); INSERT INTO LibrarySnapshots VALUES (1, 'old'), (2, 'kept');").unwrap();
        assert!(delete_work_record(&mut conn, 1).unwrap());
        for table in ["Works", "Episodes", "WorkTags", "LibrarySnapshots"] {
            let key = if table == "Works" { "Id" } else { "WorkId" };
            let count: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {key}=1"),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{table} still contains the deleted work");
        }
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM Works WHERE Id=2", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(!delete_work_record(&mut conn, 999).unwrap());
    }
}
