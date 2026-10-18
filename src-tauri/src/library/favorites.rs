use crate::library::database::Database;
#[cfg(test)]
use crate::shared::params;
use crate::shared::State;

#[cfg(test)]
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

#[cfg(test)]
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

#[tauri::command(async)]
pub fn get_favorite_characters(
    scope: String,
    db: State<Database>,
    session: State<crate::accounts::Session>,
) -> Result<Vec<String>, String> {
    let key = match session.authorize(&scope) {
        Ok(key) => key,
        Err(_) => return Ok(vec![]),
    };
    crate::accounts::personal_favorites(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        "favorite-media",
    )
}
#[tauri::command(async)]
pub fn set_character_favorite(
    scope: String,
    character_name: String,
    favorite: bool,
    db: State<Database>,
    session: State<crate::accounts::Session>,
) -> Result<Vec<String>, String> {
    let key = session.authorize(&scope)?;
    let name = character_name.trim();
    if name.is_empty() || name.len() > 512 {
        return Err("角色名无效".into());
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::accounts::set_personal_favorite(&conn, key, "favorite-media", name, favorite)?;
    crate::accounts::personal_favorites(&conn, key, "favorite-media")
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
