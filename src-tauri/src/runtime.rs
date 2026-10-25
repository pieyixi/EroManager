use crate::library::database::init_db;
use crate::{eh, library, media, player, system};
use tauri::Emitter;
mod tray;

#[cfg(windows)]
mod window_bounds;

pub fn run() {
    let db = match init_db() {
        Ok(db) => db,
        Err(error) => {
            crate::accounts::report_startup_error(&error);
            return;
        }
    };
    let session = {
        let mut conn = db.conn.lock().expect("database lock");
        crate::accounts::initialize(&mut conn, true)
            .expect("account migration failed; original data preserved");
        crate::accounts::Session::new(&conn).expect("account session")
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db)
        .manage(session)
        .setup(|app| {
            tray::setup(app)?;
            crate::accounts::install_privacy(app.handle());
            crate::accounts::install_admin_service(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("app-close-requested", ());
            }
            if let tauri::WindowEvent::Focused(focused) = event {
                player::window::sync_player_fullscreen_focus(window, *focused);
            }
            #[cfg(windows)]
            if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                window_bounds::clamp_after_dpi_change(window);
            }
        })
        // 启动查询、账号及偏好命令用 command(async) 在运行时线程池调度，
        // 包括等待共享数据库锁与结果序列化；不能让它们占用原生窗口消息线程。
        .invoke_handler(tauri::generate_handler![
            crate::accounts::account_state,
            crate::av::av_list_works,
            crate::av::av_get_settings,
            crate::av::av_bind_root,
            crate::av::av_fetch_work,
            crate::av::av_add_magnet,
            crate::av::av_remove_magnet,
            crate::av::av_get_local_videos,
            crate::accounts::account_auth,
            crate::accounts::account_lock,
            crate::accounts::account_logout,
            crate::accounts::account_update_profile,
            crate::accounts::account_change_pin,
            crate::accounts::account_get_data,
            crate::accounts::account_set_data,
            crate::settings::get_user_preferences,
            crate::settings::set_user_preferences,
            crate::settings::get_work_record,
            crate::settings::set_work_record,
            crate::settings::get_application_info,
            tray::apply_close_action,
            library::query::get_all_works_with_tags,
            library::query::get_work_detail,
            library::favorites::get_favorite_characters,
            library::favorites::set_character_favorite,
            library::query::get_tags,
            library::portable::initialize_media_library,
            library::portable::bind_media_library,
            library::delete::delete_work,
            system::open_folder,
            library::query::get_studios,
            library::import::batch_import_folders,
            library::scan::get_library_console_summary,
            library::scan::scan_library_changes,
            library::scan::apply_library_updates,
            player::window::prepare_temp_frame_capture,
            player::window::read_image_data,
            player::thumbnail::get_video_thumbnail,
            player::thumbnail::prime_video_thumbnail,
            player::thumbnail::prefetch_video_thumbnails,
            player::thumbnail::release_video_thumbnail_decoders,
            library::backup::backup_database,
            library::backup::backup_data_package,
            library::backup::restore_database,
            media::load_cover_cache,
            library::import::import_work_via_json,
            library::archive::ensure_archive_data_dir,
            library::archive::inspect_archive_folder,
            library::archive_meta::save_archive_draft,
            library::archive_meta::save_archive_json,
            library::archive_cover::save_archive_cover,
            library::archive_cover::save_archive_episode_covers,
            library::duplicates::detect_duplicates,
            library::archive::list_unarchived_folders,
            player::window::play_video,
            player::window::set_player_fullscreen,
            eh::scan::eh_get_settings,
            eh::scan::eh_save_settings,
            eh::scan::eh_bind_local_library,
            eh::scan::eh_scan_local_library,
            eh::download::eh_download_gallery,
            eh::hitomi::hitomi_download_gallery,
            eh::hitomi::hitomi_delete_gallery_folder,
            eh::query::eh_get_library_overview,
            eh::query::eh_get_library_dashboard,
            eh::query::eh_list_local_galleries,
            eh::favorites::eh_get_favorite_galleries,
            eh::favorites::eh_set_gallery_favorite,
            eh::delete::eh_delete_gallery_record,
            eh::delete::eh_delete_gallery_folder,
            eh::reader::eh_get_gallery_pages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
