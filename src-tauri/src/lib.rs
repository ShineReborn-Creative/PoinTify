mod agents;
mod claude;
mod claude_hooks;
mod hook_relay;
mod island;
mod lyrics;
mod media;
mod settings;
mod shelf;
mod tray;

/// Mode relay hooks Claude Code (`pointify.exe --hook`). Dipanggil dari
/// `main` sebelum aplikasi dibikin, jadi nggak ada jendela yang muncul.
pub fn hook_relay() -> i32 {
    hook_relay::run()
}

#[cfg_attr(mobile, mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Harus paling atas: buka PoinTify kedua kali = munculin yang udah jalan.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            island::reveal(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(settings::SettingsState::default())
        .manage(island::IslandState::default())
        .manage(media::MediaState::default())
        .manage(lyrics::LyricsCache::default())
        .manage(shelf::ShelfState::default())
        .manage(claude::ClaudeState::default())
        .manage(agents::AgentsState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            settings::init(&handle)?;
            shelf::init(&handle)?;
            island::init(&handle)?;
            media::start_watcher(handle.clone());
            tray::init(&handle)?;
            agents::start(&handle);
            settings::apply_shortcut(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            island::island_set_hit,
            island::island_focus,
            media::media_get,
            media::media_control,
            media::media_seek,
            lyrics::lyrics_fetch,
            shelf::shelf_list,
            shelf::shelf_add,
            shelf::shelf_remove,
            shelf::shelf_clear,
            shelf::shelf_open,
            shelf::shelf_reveal,
            shelf::shelf_drag_icon,
            settings::settings_get,
            settings::settings_set,
            settings::settings_open,
            claude::claude_status,
            claude::claude_send,
            claude::claude_stop,
            claude::claude_login,
            claude::claude_open_desktop,
            agents::agents_snapshot,
            agents::agents_respond,
            agents::agents_dismiss,
            claude_hooks::hooks_status,
            claude_hooks::hooks_install,
            claude_hooks::hooks_uninstall,
        ])
        .run(tauri::generate_context!())
        .expect("PoinTify gagal dijalankan");
}
