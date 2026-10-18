use super::security;
use rusqlite::{params, Connection, OptionalExtension};
pub fn read_value(
    conn: &Connection,
    key: i64,
    kind: &str,
    item: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT Value FROM AccountValues WHERE AccountKey=?1 AND Kind=?2 AND Item=?3",
        params![key, kind, item],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}
pub fn write_value(
    conn: &Connection,
    key: i64,
    kind: &str,
    item: &str,
    value: &str,
) -> Result<(), String> {
    conn.execute("INSERT INTO AccountValues(AccountKey,Kind,Item,Value) VALUES(?1,?2,?3,?4) ON CONFLICT(AccountKey,Kind,Item) DO UPDATE SET Value=excluded.Value,UpdatedAt=CURRENT_TIMESTAMP",params![key,kind,item,value]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn has_pin(conn: &Connection, key: i64) -> Result<bool, String> {
    conn.query_row(
        "SELECT length(PinHash)>0 FROM Accounts WHERE AccountKey=?1",
        [key],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
pub fn last_account(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT AccountKey FROM Accounts WHERE LoginId!='0000' AND Disabled=0 ORDER BY AccountKey=COALESCE((SELECT CAST(Value AS INTEGER) FROM AppSettings WHERE Key='active_account_v1'),0) DESC,AccountKey LIMIT 1",[],|r|r.get(0)).map_err(|_|"没有可用普通账号，请关闭软件并通过 --admin 创建或启用账号".into())
}
pub fn set_pin(conn: &Connection, key: i64, pin: &str) -> Result<(), String> {
    let (salt, hash) = if pin.is_empty() {
        (vec![], vec![])
    } else {
        security::hash_pin(pin)?
    };
    conn.execute(
        "UPDATE Accounts SET PinSalt=?1,PinHash=?2 WHERE AccountKey=?3",
        params![salt, hash, key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn verify_pin(conn: &Connection, key: i64, pin: &str) -> Result<bool, String> {
    let (salt, hash): (Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT PinSalt,PinHash FROM Accounts WHERE AccountKey=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(if hash.is_empty() {
        pin.is_empty()
    } else {
        security::verify(pin, &salt, &hash)
    })
}
pub fn create(
    conn: &Connection,
    name: &str,
    pin: &str,
    copy: Option<i64>,
) -> Result<String, String> {
    if name.trim().is_empty() || name.chars().count() > 24 {
        return Err("昵称应为1至24个字符".into());
    }
    if !pin.is_empty() && !security::valid_pin(pin) {
        return Err("PIN 必须为四位数字".into());
    }
    let id = (1..=9999)
        .find(|n| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM Accounts WHERE LoginId=?1)",
                [format!("{n:04}")],
                |r| r.get::<_, bool>(0),
            )
            .unwrap_or(true)
                == false
        })
        .ok_or("四位账号已用完")?;
    conn.execute_batch("SAVEPOINT create_account")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        conn.execute(
            "INSERT INTO Accounts(LoginId,Nickname) VALUES(?1,?2)",
            params![format!("{id:04}"), name.trim()],
        )
        .map_err(|e| e.to_string())?;
        let key = conn.last_insert_rowid();
        set_pin(conn, key, pin)?;
        if let Some(from) = copy {
            conn.execute("INSERT INTO AccountValues(AccountKey,Kind,Item,Value) SELECT ?1,Kind,Item,Value FROM AccountValues WHERE AccountKey=?2 AND Kind='preferences'",params![key,from]).map_err(|e|e.to_string())?;
        }
        Ok(format!("{id:04}"))
    })();
    if result.is_ok() {
        conn.execute_batch("RELEASE create_account")
    } else {
        conn.execute_batch("ROLLBACK TO create_account; RELEASE create_account")
    }
    .map_err(|e| e.to_string())?;
    result
}
pub fn initialize(conn: &mut Connection, backup: bool) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='Accounts')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }
    // 一次性迁移前由 SQLite 生成含 WAL 已提交内容的一致快照，保留原表作为兼容证据。
    if backup {
        let path = crate::paths::portable_app_dir().join("db").join(format!(
            "before-accounts-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
            .map_err(|e| format!("账号迁移前备份失败：{e}"))?;
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE Accounts(AccountKey INTEGER PRIMARY KEY AUTOINCREMENT,LoginId TEXT NOT NULL UNIQUE CHECK(length(LoginId)=4 AND LoginId NOT GLOB '*[^0-9]*'),Nickname TEXT NOT NULL,Avatar BLOB NOT NULL DEFAULT X'',PinSalt BLOB NOT NULL DEFAULT X'',PinHash BLOB NOT NULL DEFAULT X'',Disabled INTEGER NOT NULL DEFAULT 0,CreatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE AccountValues(AccountKey INTEGER NOT NULL REFERENCES Accounts(AccountKey) ON DELETE CASCADE,Kind TEXT NOT NULL,Item TEXT NOT NULL,Value TEXT NOT NULL,UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(AccountKey,Kind,Item));
    INSERT INTO Accounts(LoginId,Nickname) VALUES('0000','管理员'),('0001','本地资料库');
    INSERT INTO AccountValues(AccountKey,Kind,Item,Value) SELECT 2,'preferences','',Value FROM AppSettings WHERE Key='user_preferences_v1';
    INSERT INTO AccountValues(AccountKey,Kind,Item,Value) SELECT 2,'favorite-media',CharacterName,'true' FROM FavoriteCharacters;
    INSERT INTO AppSettings(Key,Value) VALUES('active_account_v1','2') ON CONFLICT(Key) DO NOTHING;").map_err(|e|e.to_string())?;
    let records: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='WorkRecords')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if records {
        let mut query = tx
            .prepare("SELECT Kind,ContentId,Position,PairOffset,MergedPairs FROM WorkRecords")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, i32>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (kind, id, position, pair_offset, merged) = row.map_err(|e| e.to_string())?;
            let value = serde_json::json!({"kind":kind,"content_id":id,"position":position,"pair_offset":pair_offset,"merged_pairs":serde_json::from_str::<serde_json::Value>(&merged).map_err(|e|e.to_string())?});
            write_value(
                &tx,
                2,
                "record",
                &format!("{kind}:{id}"),
                &value.to_string(),
            )?;
        }
    }
    let eh_path =
        crate::paths::portable_database_path("eh-database.db").map_err(|e| e.to_string())?;
    if eh_path.exists() {
        let eh = Connection::open_with_flags(eh_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        let table: bool = eh
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='EhFavoriteGalleries')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if table {
            let mut query = eh
                .prepare("SELECT Gid FROM EhFavoriteGalleries")
                .map_err(|e| e.to_string())?;
            for row in query
                .query_map([], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
            {
                write_value(
                    &tx,
                    2,
                    "favorite-book",
                    &row.map_err(|e| e.to_string())?.to_string(),
                    "true",
                )?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn favorites(conn: &Connection, key: i64, kind: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT Item FROM AccountValues WHERE AccountKey=?1 AND Kind=?2 ORDER BY Item")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![key, kind], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
pub fn favorite(
    conn: &Connection,
    key: i64,
    kind: &str,
    item: &str,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        write_value(conn, key, kind, item, "true")
    } else {
        conn.execute(
            "DELETE FROM AccountValues WHERE AccountKey=?1 AND Kind=?2 AND Item=?3",
            params![key, kind, item],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
