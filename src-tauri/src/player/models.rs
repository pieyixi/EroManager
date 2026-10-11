use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CapturedFrameData {
    pub image_data: String,
}

#[derive(Debug, Serialize)]
pub struct CapturePath {
    pub path: String,
}
