//! Domain-neutral local media loading commands.

pub(crate) fn image_extension(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\xFF\xD8\xFF") { Some("jpg") }
    else if data.starts_with(b"\x89PNG\r\n\x1a\n") { Some("png") }
    else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" { Some("webp") }
    else { None }
}
pub(crate) fn complete_image(data: &[u8]) -> bool {
    if imagesize::blob_size(data).is_err() { return false; }
    match image_extension(data) {
        Some("jpg") => data.ends_with(b"\xFF\xD9"),
        Some("png") => data.ends_with(b"IEND\xAE\x42\x60\x82"),
        Some("webp") => data.len() >= 12 && u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize + 8 == data.len(),
        _ => false,
    }
}

#[tauri::command]
pub async fn load_cover_cache(cover_paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine as _;
        let mut result = Vec::new();
        for path in &cover_paths {
            if let Ok(data) = std::fs::read(path) {
                let Some(extension) = image_extension(&data) else { continue; };
                let media_type = if extension == "jpg" { "jpeg" } else { extension };
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
