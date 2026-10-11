#[cfg(test)]
mod eh_tests {
    use super::super::database::{portable_path, validate_root};
    use super::super::metadata::{
        clean_display_title, create_cover_from_available_source, localize_gallery, parse_ehviewer,
    };
    use super::super::models::{EhGallerySummary, EhSettings};
    use super::super::scan::scan_eh_library;
    use std::fs;
    use std::path::Path;
    #[test]
    fn localizes_supported_metadata_without_replacing_canonical_values() {
        let gallery = localize_gallery(EhGallerySummary {
            gid: 1,
            token: String::new(),
            source: "eh".to_string(),
            source_id: "1".to_string(),
            language: String::new(),
            title: String::new(),
            category: 2,
            artist: vec!["1-gou".to_string()],
            group: vec!["0846net".to_string()],
            tags: vec!["big breasts".to_string()],
            artist_display: Vec::new(),
            group_display: Vec::new(),
            tags_display: Vec::new(),
            pages: 1,
            posted: String::new(),
            added_at: String::new(),
            cover_path: String::new(),
            folder_path: String::new(),
        });
        assert_eq!(gallery.artist, ["1-gou"]);
        assert_eq!(gallery.artist_display, ["1号"]);
        assert_eq!(gallery.group_display, ["オヤシロネット"]);
        assert_eq!(gallery.tags_display, ["巨乳"]);
    }

    #[test]
    fn parses_ehviewer_identity() {
        let root = std::env::temp_dir().join(format!("ehviewer-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join(".ehviewer");
        fs::write(&path, "VERSION2\n00000000\n440955\n0b9113090f\n1\n2\n").unwrap();
        assert_eq!(
            parse_ehviewer(&path).unwrap(),
            (440955, "0b9113090f".to_string())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleans_gallery_credits_and_release_qualifiers() {
        assert_eq!(
            clean_display_title("(C89) [幸せ共和国 (幸せのかたち)] 幸せのかたち＋ペーパー"),
            "幸せのかたち"
        );
        assert_eq!(
            clean_display_title("[世徒ゆうき] レベルＣ (COMIC MUJIN 2011年5月号) [無修正]"),
            "レベルＣ"
        );
        assert_eq!(
            clean_display_title("[DOZA Village] 女神すぎるママ [DL版]"),
            "女神すぎるママ"
        );
    }

    #[test]
    fn removes_windows_extended_path_prefix_for_display_and_storage() {
        assert_eq!(portable_path(Path::new(r"\\?\D:\Ehentai")), r"D:\Ehentai");
        assert_eq!(
            portable_path(Path::new(r"\\?\UNC\server\library")),
            r"\\server\library"
        );
    }

    #[test]
    fn falls_back_to_the_first_page_when_thumb_is_missing() {
        let root = std::env::temp_dir().join(format!("eh-cover-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("002.png"), b"second").unwrap();
        fs::write(root.join("001.jpg"), b"first").unwrap();
        let data = root.join("data");
        create_cover_from_available_source(&root, &data).unwrap();
        assert_eq!(fs::read(data.join("cover.jpg")).unwrap(), b"first");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "explicit integration test; writes only to EH_SCAN_TEST_ROOT"]
    fn scans_explicit_test_library() {
        let root = std::env::var("EH_SCAN_TEST_ROOT").expect("EH_SCAN_TEST_ROOT is required");
        let root = validate_root(&root).unwrap();
        let settings = EhSettings {
            root_path: root.to_string_lossy().to_string(),
            ..EhSettings::default()
        };
        let result = scan_eh_library(&root, &settings, |_, _, _| {}).unwrap();
        assert!(result.errors.is_empty(), "{:#?}", result.errors);
        assert_eq!(result.indexed, result.folders);
    }
}
