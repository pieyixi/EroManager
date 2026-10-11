//! Archive metadata serialization, validation, and persistence.
use crate::library::archive::{value_non_empty_array, value_non_empty_string};
use crate::library::archive_cover::write_image_data;
use crate::library::inspection::folder_video_stats;
use crate::library::models::{
    collect_numbered_video_paths, ArchiveEpisodeMetaOutput, ArchiveMetaOutput, ArchiveSaveInput,
};

fn serialize_archive_meta(json: &ArchiveMetaOutput) -> Result<String, String> {
    use std::fmt::Write as _;

    fn encoded<T: serde::Serialize>(value: &T) -> Result<String, String> {
        serde_json::to_string(value).map_err(|error| error.to_string())
    }

    fn compact_string_array(values: &[String]) -> Result<String, String> {
        let items = values.iter().map(encoded).collect::<Result<Vec<_>, _>>()?;
        Ok(format!("[{}]", items.join(", ")))
    }

    let mut output = String::new();
    writeln!(output, "{{").unwrap();
    writeln!(output, "  \"title\": {},", encoded(&json.title)?).unwrap();
    if json.search_aliases.is_empty() {
        writeln!(output, "  \"search_aliases\": [],").unwrap();
    } else {
        writeln!(output, "  \"search_aliases\": [").unwrap();
        for (index, alias) in json.search_aliases.iter().enumerate() {
            let comma = if index + 1 == json.search_aliases.len() {
                ""
            } else {
                ","
            };
            writeln!(output, "    {}{}", encoded(alias)?, comma).unwrap();
        }
        writeln!(output, "  ],").unwrap();
    }
    writeln!(output, "  \"episodes\": {},", json.episodes).unwrap();
    writeln!(output, "  \"characters\": {{").unwrap();
    let mut characters = json.characters.iter().collect::<Vec<_>>();
    characters.sort_by(
        |(left, _), (right, _)| match (left.parse::<u64>(), right.parse::<u64>()) {
            (Ok(left_number), Ok(right_number)) => {
                left_number.cmp(&right_number).then_with(|| left.cmp(right))
            }
            (Ok(_), Err(_)) => std::cmp::Ordering::Less,
            (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
            (Err(_), Err(_)) => left.cmp(right),
        },
    );
    for (index, (position, name)) in characters.iter().enumerate() {
        let comma = if index + 1 == characters.len() {
            ""
        } else {
            ","
        };
        writeln!(
            output,
            "    {}: {}{}",
            encoded(position)?,
            encoded(name)?,
            comma
        )
        .unwrap();
    }
    writeln!(output, "  }},").unwrap();
    writeln!(output, "  \"studio\": {},", encoded(&json.studio)?).unwrap();
    writeln!(output, "  \"synopsis\": {},", encoded(&json.synopsis)?).unwrap();
    writeln!(output, "  \"episode_list\": [").unwrap();
    for (index, episode) in json.episode_list.iter().enumerate() {
        writeln!(output, "    {{").unwrap();
        writeln!(output, "      \"id\": {},", episode.id).unwrap();
        writeln!(
            output,
            "      \"subtitle\": {},",
            encoded(&episode.subtitle)?
        )
        .unwrap();
        writeln!(
            output,
            "      \"release_date\": {},",
            encoded(&episode.release_date)?
        )
        .unwrap();
        writeln!(output, "      \"tags\": {{").unwrap();
        writeln!(
            output,
            "        \"theme\": {},",
            compact_string_array(&episode.tags.theme)?
        )
        .unwrap();
        writeln!(
            output,
            "        \"attribute\": {},",
            compact_string_array(&episode.tags.attribute)?
        )
        .unwrap();
        writeln!(
            output,
            "        \"scene\": {}",
            compact_string_array(&episode.tags.scene)?
        )
        .unwrap();
        writeln!(output, "      }}").unwrap();
        let comma = if index + 1 == json.episode_list.len() {
            ""
        } else {
            ","
        };
        writeln!(output, "    }}{}", comma).unwrap();
    }
    writeln!(output, "  ]").unwrap();
    write!(output, "}}").unwrap();
    Ok(output)
}

#[tauri::command]
pub fn save_archive_draft(input: ArchiveSaveInput) -> Result<String, String> {
    let path = std::path::Path::new(&input.dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let data_dir = path.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    if let Some(ref cover_data) = input.cover_data {
        write_image_data(&data_dir, "cover", cover_data)?;
    }
    let episode_list = input
        .episode_list
        .iter()
        .map(|episode| ArchiveEpisodeMetaOutput {
            id: episode.id,
            subtitle: episode.subtitle.clone(),
            release_date: episode.release_date.clone(),
            tags: episode.tags.clone(),
        })
        .collect::<Vec<_>>();
    let json = ArchiveMetaOutput {
        title: input.title,
        search_aliases: input.search_aliases,
        episodes: episode_list.len(),
        characters: input.characters,
        studio: input.studio,
        synopsis: input.synopsis,
        episode_list,
    };
    let out_path = data_dir.join("meta.json");
    std::fs::write(&out_path, serialize_archive_meta(&json)?).map_err(|error| error.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

fn validate_archive_meta_json(json: &serde_json::Value, dir_path: &str) -> Vec<String> {
    let mut reasons = Vec::new();
    if !json.is_object() {
        return vec!["根节点必须是 JSON 对象".to_string()];
    }
    for (field, label) in [
        ("title", "title"),
        ("studio", "studio"),
        ("synopsis", "synopsis"),
    ] {
        if !value_non_empty_string(json.get(field)) {
            reasons.push(format!("缺少 {label}"));
        }
    }
    let characters_complete = json
        .get("characters")
        .and_then(|value| value.as_object())
        .map(|map| {
            !map.is_empty()
                && map.values().any(|value| {
                    value
                        .as_str()
                        .map(|text| !text.trim().is_empty())
                        .unwrap_or(false)
                })
        })
        .unwrap_or(false);
    if !characters_complete {
        reasons.push("缺少 characters".to_string());
    }
    let episodes = json.get("episode_list").and_then(|value| value.as_array());
    if episodes.is_none() {
        reasons.push("缺少 episode_list 数组".to_string());
    }
    let episode_len = episodes.map(|items| items.len()).unwrap_or(0);
    if json
        .get("episodes")
        .and_then(|value| value.as_u64())
        .map(|count| count as usize)
        != Some(episode_len)
    {
        reasons.push("episodes 必须等于 episode_list 数量".to_string());
    }
    let video_count = match folder_video_stats(dir_path) {
        Ok((count, _)) => count,
        Err(error) => {
            reasons.push(error);
            0
        }
    };
    if let Err(error) = collect_numbered_video_paths(std::path::Path::new(dir_path)) {
        reasons.push(error);
    }
    if video_count > 0 && episode_len != video_count as usize {
        reasons.push("episode_list 数量必须等于视频数量".to_string());
    }
    if let Some(episodes) = episodes {
        for (index, episode) in episodes.iter().enumerate() {
            let number = index + 1;
            if episode.get("id").and_then(|value| value.as_i64()).is_none() {
                reasons.push(format!("第{}集缺少 id", number));
            }
            if !value_non_empty_string(episode.get("release_date")) {
                reasons.push(format!("第{}集缺少 release_date", number));
            }
            let tags = episode.get("tags");
            let has_tags = value_non_empty_array(tags.and_then(|value| value.get("theme")))
                || value_non_empty_array(tags.and_then(|value| value.get("attribute")))
                || value_non_empty_array(tags.and_then(|value| value.get("scene")));
            if !has_tags {
                reasons.push(format!("第{}集缺少 tags", number));
            }
        }
    }
    reasons
}

#[tauri::command]
pub fn save_archive_json(dir_path: String, json_text: String) -> Result<String, String> {
    let path = std::path::Path::new(&dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let json: serde_json::Value =
        serde_json::from_str(&json_text).map_err(|error| format!("JSON 格式错误: {}", error))?;
    let reasons = validate_archive_meta_json(&json, &dir_path);
    if !reasons.is_empty() {
        return Err(format!("JSON 不完整: {}", reasons.join("、")));
    }
    let data_dir = path.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let out_path = data_dir.join("meta.json");
    std::fs::write(&out_path, format!("{}\n", json_text.trim()))
        .map_err(|error| error.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::serialize_archive_meta;
    use crate::library::models::{ArchiveEpisodeMetaOutput, ArchiveEpisodeTags, ArchiveMetaOutput};
    use std::collections::HashMap;

    #[test]
    fn keeps_character_positions_ordered_and_tag_arrays_compact() {
        let mut characters = HashMap::new();
        for position in (1..=12).rev() {
            characters.insert(position.to_string(), format!("角色{}", position));
        }
        let meta = ArchiveMetaOutput {
            title: "测试".into(),
            search_aliases: vec!["测试别名".into()],
            episodes: 1,
            characters,
            studio: "制作商".into(),
            synopsis: "第一行\n第二行".into(),
            episode_list: vec![ArchiveEpisodeMetaOutput {
                id: 1,
                subtitle: String::new(),
                release_date: "2026-08".into(),
                tags: ArchiveEpisodeTags {
                    theme: vec!["纯爱".into(), "后宫".into()],
                    attribute: vec!["姐".into()],
                    scene: vec!["内射".into(), "口交".into()],
                },
            }],
        };
        let output = serialize_archive_meta(&meta).unwrap();
        serde_json::from_str::<serde_json::Value>(&output).unwrap();
        let positions = (1..=12)
            .map(|position| output.find(&format!("\"{}\":", position)).unwrap())
            .collect::<Vec<_>>();
        assert!(positions.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(output.contains("\"theme\": [\"纯爱\", \"后宫\"]"));
    }
}
