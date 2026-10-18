use crate::library::database::Database;
use crate::library::models::*;
use crate::shared::*;

#[tauri::command]
pub fn get_work_detail(work_id: i64, db: State<Database>) -> Result<WorkDetail, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get work
    let work = conn.query_row(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w WHERE w.Id = ?1",
        params![work_id],
        |row| Ok(Work {
            id: row.get(0)?,
            title: row.get(1)?,
            year: row.get(2)?,
            month: row.get(3)?,
            studio: row.get(4)?,
            description: row.get(5)?,
            cover_path: row.get(6)?,
            folder_path: row.get(7)?,
            episode_count: row.get(8)?,
        })
    ).map_err(|e| e.to_string())?;

    // Get episodes
    let mut ep_stmt = conn.prepare(
        "SELECT Id, WorkId, Number, Title, VideoPath, CoverPath FROM Episodes WHERE WorkId = ?1 ORDER BY Number"
    ).map_err(|e| e.to_string())?;

    let mut episodes: Vec<Episode> = ep_stmt
        .query_map(params![work_id], |row| {
            Ok(Episode {
                id: row.get(0)?,
                work_id: row.get(1)?,
                number: row.get(2)?,
                title: row.get(3)?,
                video_path: row.get(4)?,
                cover_path: row.get(5)?,
                release_date: None,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<Episode>, _>>()
        .map_err(|e| e.to_string())?;

    // Release dates belong to individual entries in data/meta.json. The database
    // intentionally keeps only the first date for library ordering, so hydrate
    // the detail view from the canonical metadata file.
    let meta_path = std::path::Path::new(&work.folder_path)
        .join("data")
        .join("meta.json");
    let mut characters: Vec<String> = Vec::new();
    if let Ok(content) = std::fs::read_to_string(meta_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let release_dates: std::collections::HashMap<i32, String> = json
                .get("episode_list")
                .and_then(|list| list.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|item| {
                            let id = item.get("id")?.as_i64()? as i32;
                            let date = item.get("release_date")?.as_str()?.trim();
                            (!date.is_empty()).then(|| (id, date.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            for episode in &mut episodes {
                episode.release_date = release_dates.get(&episode.number).cloned();
            }

            characters = json
                .get("characters")
                .and_then(|chars| chars.as_object())
                .map(|chars| {
                    let mut ordered: Vec<(i32, String)> = chars
                        .iter()
                        .filter_map(|(key, value)| {
                            let index = key.parse::<i32>().ok()?;
                            let name = value.as_str()?.trim();
                            (!name.is_empty()).then(|| (index, name.to_string()))
                        })
                        .collect();
                    ordered.sort_by_key(|(index, _)| *index);
                    ordered.into_iter().map(|(_, name)| name).collect()
                })
                .unwrap_or_default();
        }
    }

    // Get tags
    let mut tag_stmt = conn
        .prepare(
            "SELECT t.Id, t.Name, t.Category FROM Tags t
         INNER JOIN WorkTags wt ON t.Id = wt.TagId
         WHERE wt.WorkId = ?1 ORDER BY t.Category, t.Name",
        )
        .map_err(|e| e.to_string())?;

    let tags = tag_stmt
        .query_map(params![work_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<Tag>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(WorkDetail {
        work,
        episodes,
        tags,
        characters,
    })
}

#[tauri::command]
pub fn get_tags(db: State<Database>) -> Result<Vec<Tag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT t.Id, t.Name, t.Category
             FROM Tags t
             WHERE EXISTS (
                 SELECT 1 FROM WorkTags wt WHERE wt.TagId = t.Id
             )
             ORDER BY t.Category, t.Name",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<Tag>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(tags)
}

#[tauri::command]
pub fn get_studios(db: State<Database>) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT DISTINCT Studio FROM Works WHERE Studio != '' ORDER BY Studio")
        .map_err(|e| e.to_string())?;
    let studios = statement
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(studios)
}

struct WorkRow {
    id: i64,
    title: String,
    year: i32,
    month: i32,
    studio: String,
    description: Option<String>,
    cover_path: Option<String>,
    folder_path: String,
    search_aliases: String,
    episode_count: i64,
}

fn imported_work_is_available(
    conn: &Connection,
    work_id: i64,
    folder_path: &str,
    cover_path: Option<&str>,
) -> Result<bool, String> {
    if !std::path::Path::new(folder_path).is_dir()
        || !cover_path
            .map(|path| std::path::Path::new(path).is_file())
            .unwrap_or(false)
    {
        return Ok(false);
    }
    let mut statement = conn
        .prepare("SELECT VideoPath, CoverPath FROM Episodes WHERE WorkId=?1 ORDER BY Number")
        .map_err(|e| e.to_string())?;
    let episodes = statement
        .query_map(params![work_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<(String, Option<String>)>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(!episodes.is_empty()
        && episodes.iter().all(|(video, cover)| {
            std::path::Path::new(video).is_file()
                && cover
                    .as_deref()
                    .map(|path| std::path::Path::new(path).is_file())
                    .unwrap_or(false)
        }))
}

#[tauri::command]
pub fn get_all_works_with_tags(db: State<Database>) -> Result<Vec<WorkWithTags>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath, w.SearchAliases,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w ORDER BY w.UpdatedAt DESC"
    ).map_err(|e| e.to_string())?;

    let works = stmt
        .query_map([], |row| {
            Ok(WorkRow {
                id: row.get(0)?,
                title: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                studio: row.get(4)?,
                description: row.get(5)?,
                cover_path: row.get(6)?,
                folder_path: row.get(7)?,
                search_aliases: row.get(8)?,
                episode_count: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<WorkRow>, _>>()
        .map_err(|e| e.to_string())?;

    let mut tag_stmt = conn
        .prepare(
            "SELECT wt.WorkId, t.Id, t.Name, t.Category FROM Tags t
         INNER JOIN WorkTags wt ON t.Id = wt.TagId ORDER BY t.Category, t.Name",
        )
        .map_err(|e| e.to_string())?;

    let tag_rows: Vec<(i64, i64, String, String)> = tag_stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<(i64, i64, String, String)>, _>>()
        .map_err(|e| e.to_string())?;

    let mut tags_map: std::collections::HashMap<i64, Vec<Tag>> = std::collections::HashMap::new();
    for (work_id, tag_id, name, category) in tag_rows {
        tags_map.entry(work_id).or_default().push(Tag {
            id: tag_id,
            name,
            category,
        });
    }

    let mut result = Vec::with_capacity(works.len());
    for work in works {
        if !imported_work_is_available(
            &conn,
            work.id,
            &work.folder_path,
            work.cover_path.as_deref(),
        )? {
            continue;
        }
        let release_dates = read_work_release_months(&work.folder_path, work.year, work.month);
        result.push(WorkWithTags {
            id: work.id,
            title: work.title,
            year: work.year,
            month: work.month,
            studio: work.studio,
            description: work.description,
            cover_path: work.cover_path,
            folder_path: work.folder_path,
            episode_count: work.episode_count,
            release_dates,
            search_aliases: serde_json::from_str(&work.search_aliases).unwrap_or_default(),
            tags: tags_map.remove(&work.id).unwrap_or_default(),
        });
    }

    Ok(result)
}

fn read_work_release_months(
    folder_path: &str,
    fallback_year: i32,
    fallback_month: i32,
) -> Vec<String> {
    let meta_path = std::path::Path::new(folder_path)
        .join("data")
        .join("meta.json");
    let mut months = std::fs::read_to_string(meta_path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|json| {
            json.get("episode_list")
                .and_then(|list| list.as_array())
                .cloned()
        })
        .map(|list| {
            list.into_iter()
                .filter_map(|item| {
                    let date = item.get("release_date")?.as_str()?.trim();
                    let mut parts = date.split('-');
                    let year = parts.next()?.parse::<i32>().ok()?;
                    let month = parts.next()?.parse::<u32>().ok()?;
                    (1..=12)
                        .contains(&month)
                        .then(|| format!("{year:04}-{month:02}"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut seen = std::collections::HashSet::new();
    months.retain(|month| seen.insert(month.clone()));
    if months.is_empty() {
        months.push(format!("{fallback_year:04}-{fallback_month:02}"));
    }
    months
}

#[cfg(test)]
mod imported_work_visibility_tests {
    use super::imported_work_is_available;
    use rusqlite::{params, Connection};

    #[test]
    fn ignores_extra_unimported_videos_when_existing_assets_are_present() {
        let root = std::env::temp_dir().join(format!(
            "ero-manager-visible-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("data")).unwrap();
        let cover = root.join("data/cover.jpg");
        let episode_cover = root.join("data/cover_ep1.jpg");
        let imported_video = root.join("title #1.mp4");
        let extra_video = root.join("title #2.mp4");
        for path in [&cover, &episode_cover, &imported_video, &extra_video] {
            std::fs::write(path, b"test").unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Episodes (
                Id INTEGER PRIMARY KEY,
                WorkId INTEGER NOT NULL,
                Number INTEGER NOT NULL,
                VideoPath TEXT NOT NULL,
                CoverPath TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Episodes (WorkId, Number, VideoPath, CoverPath) VALUES (1, 1, ?1, ?2)",
            params![
                imported_video.to_string_lossy().to_string(),
                episode_cover.to_string_lossy().to_string()
            ],
        )
        .unwrap();

        assert!(imported_work_is_available(
            &conn,
            1,
            &root.to_string_lossy(),
            Some(&cover.to_string_lossy())
        )
        .unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
