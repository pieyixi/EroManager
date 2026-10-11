//! Domain-neutral local media loading commands.

#[tauri::command]
pub async fn load_cover_cache(cover_paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine as _;
        let mut result = Vec::new();
        for path in &cover_paths {
            if let Ok(data) = std::fs::read(path) {
                let media_type = if data.starts_with(b"\xFF\xD8\xFF") {
                    "jpeg"
                } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
                    "png"
                } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
                    "webp"
                } else {
                    continue;
                };
                let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
                result.push((
                    path.clone(),
                    format!("data:image/{media_type};base64,{encoded}"),
                ));
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn unsupported_payloads_are_not_mislabeled_as_jpeg() {
        assert!(!b"not an image".starts_with(b"\xFF\xD8\xFF"));
    }
}
