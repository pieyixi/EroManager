//! Source-aware metadata bridge into the shared Eh gallery model.
use super::protocol::HitomiInfo;
use super::storage::parse_id;
use crate::eh::database::portable_path;
use crate::eh::models::EhGallerySummary;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct HitomiMeta {
    pub(super) source: String,
    pub(super) source_id: String,
    pub(super) title: String,
    pub(super) category: i64,
    pub(super) artist: Vec<String>,
    pub(super) group: Vec<String>,
    pub(super) tags: Vec<String>,
    pub(super) pages: i64,
    pub(super) posted: String,
    pub(super) language: String,
    pub(super) source_category: String,
    pub(super) source_tags: Vec<String>,
    pub(super) series: Vec<String>,
    pub(super) characters: Vec<String>,
    pub(super) image_format: String,
}

impl HitomiMeta {
    pub(crate) fn into_summary(
        self,
        folder: &Path,
        cover: &Path,
    ) -> Result<EhGallerySummary, String> {
        if self.source != "hitomi" {
            return Err("Hitomi meta 来源无效".into());
        }
        let id = parse_id(&self.source_id)?;
        Ok(EhGallerySummary {
            gid: -id,
            token: String::new(),
            source: self.source,
            source_id: self.source_id,
            language: self.language,
            title: self.title,
            category: self.category,
            artist: self.artist,
            group: self.group,
            tags: self.tags,
            artist_display: Vec::new(),
            group_display: Vec::new(),
            tags_display: Vec::new(),
            pages: self.pages,
            posted: self.posted,
            added_at: String::new(),
            cover_path: portable_path(cover),
            folder_path: portable_path(folder),
        })
    }
}

fn category(kind: &str) -> i64 {
    match kind
        .to_ascii_lowercase()
        .replace([' ', '_', '-'], "")
        .as_str()
    {
        "doujinshi" => 2,
        "manga" => 4,
        "artistcg" => 8,
        "gamecg" => 16,
        "imageset" => 32,
        "cosplay" => 64,
        "nonh" => 256,
        "western" => 512,
        _ => 0,
    }
}

pub(super) fn metadata(info: &HitomiInfo) -> HitomiMeta {
    fn marked(value: &Option<serde_json::Value>) -> bool {
        match value {
            Some(serde_json::Value::String(value)) => !value.is_empty(),
            Some(serde_json::Value::Number(value)) => {
                value.as_i64().is_some_and(|value| value != 0)
            }
            Some(serde_json::Value::Bool(value)) => *value,
            _ => false,
        }
    }
    let mut tags = Vec::new();
    let mut source_tags = Vec::new();
    for entry in info.tags.as_deref().unwrap_or(&[]) {
        if marked(&entry.female) {
            tags.push(entry.tag.clone());
            source_tags.push(format!("female:{}", entry.tag));
        } else if marked(&entry.male) {
            tags.push(format!("male:{}", entry.tag));
            source_tags.push(format!("male:{}", entry.tag));
        } else {
            tags.push(entry.tag.clone());
            source_tags.push(entry.tag.clone());
        }
    }
    HitomiMeta {
        source: "hitomi".into(),
        source_id: info
            .id
            .as_i64()
            .map(|id| id.to_string())
            .or_else(|| info.id.as_str().map(str::to_owned))
            .unwrap_or_default(),
        title: info
            .japanese_title
            .as_deref()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or(&info.title)
            .to_string(),
        category: category(&info.kind),
        artist: info
            .artists
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|v| v.artist.clone())
            .collect(),
        group: info
            .groups
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|v| v.group.clone())
            .collect(),
        tags,
        pages: info.files.len() as i64,
        posted: info.date.clone(),
        language: info.language.clone().unwrap_or_default(),
        source_category: info.kind.clone(),
        source_tags,
        series: info
            .parodys
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|v| v.parody.clone())
            .collect(),
        characters: info
            .characters
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .filter_map(|v| v.character.clone())
            .collect(),
        image_format: "webp".into(),
    }
}
