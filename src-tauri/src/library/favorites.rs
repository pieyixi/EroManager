use crate::library::database::Database;
use crate::shared::{params, State};

fn read_favorite_characters(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT CharacterName FROM FavoriteCharacters ORDER BY CharacterName COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let favorites = statement
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(favorites)
}

fn write_character_favorite(
    conn: &rusqlite::Connection,
    character_name: &str,
    favorite: bool,
) -> Result<Vec<String>, String> {
    let name = character_name.trim();
    if name.is_empty() {
        return Err("角色名不能为空".to_string());
    }
    if favorite {
        conn.execute(
            "INSERT OR IGNORE INTO FavoriteCharacters (CharacterName) VALUES (?1)",
            params![name],
        )
    } else {
        conn.execute(
            "DELETE FROM FavoriteCharacters WHERE CharacterName = ?1",
            params![name],
        )
    }
    .map_err(|e| e.to_string())?;
    read_favorite_characters(conn)
}

#[tauri::command]
pub fn get_favorite_characters(db: State<Database>) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    read_favorite_characters(&conn)
}

#[tauri::command]
pub fn set_character_favorite(
    character_name: String,
    favorite: bool,
    db: State<Database>,
) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    write_character_favorite(&conn, &character_name, favorite)
}

#[cfg(test)]
mod tests {
    use super::{read_favorite_characters, write_character_favorite};
    use rusqlite::Connection;

    #[test]
    fn toggles_unique_character_names() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE FavoriteCharacters (CharacterName TEXT PRIMARY KEY, CreatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')));").unwrap();
        assert_eq!(
            write_character_favorite(&conn, "  枫  ", true).unwrap(),
            vec!["枫"]
        );
        assert_eq!(
            write_character_favorite(&conn, "枫", true).unwrap(),
            vec!["枫"]
        );
        assert_eq!(
            write_character_favorite(&conn, "铃", true).unwrap(),
            vec!["枫", "铃"]
        );
        assert_eq!(
            write_character_favorite(&conn, "枫", false).unwrap(),
            vec!["铃"]
        );
        assert_eq!(read_favorite_characters(&conn).unwrap(), vec!["铃"]);
    }
}
