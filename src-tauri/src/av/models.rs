use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AvVideo {
    pub id: u32,
    pub kind: String,
    pub file_name: String,
    pub video_path: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct AvActress {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub photo: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct AvWork {
    pub code: String,
    pub title: String,
    pub cover: String,
    pub cover_layout: String,
    pub release_date: String,
    pub duration_minutes: u32,
    pub studio: String,
    pub series: String,
    pub tags: Vec<String>,
    pub actresses: Vec<AvActress>,
    pub folder_path: String,
    pub source_url: String,
    pub queued_at: String,
    pub previews: Vec<String>,
    pub magnets: Vec<String>,
    pub videos: Vec<AvVideo>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AvSettings {
    pub root_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AvFetchResult {
    pub work: AvWork,
    pub warnings: Vec<String>,
}
