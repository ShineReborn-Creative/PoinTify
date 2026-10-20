//! Ikon di system tray: buka notch, chat, pengaturan, sembunyikan, keluar.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Buka PoinTify", true, None::<&str>)?;
    let chat = MenuItem::with_id(app, "chat", "Chat dengan Claude", true, Some("Ctrl+Alt+P"))?;
    let settings = MenuItem::with_id(app, "settings", "Pengaturan…", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Sembunyikan notch", true, None::<&str>)?;
    let pet = MenuItem::with_id(app, "pet", "Pip di desktop: keluar/masuk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &chat, &settings, &sep1, &pet, &pause, &sep2, &quit])?;

    let pause_item = pause.clone();
    let mut builder = TrayIconBuilder::with_id("pointify")
        .tooltip("PoinTify")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => crate::island::reveal(app),
            "chat" => crate::island::toggle_chat(app),
            "settings" => crate::settings::open_window_later(app),
            "pet" => crate::pet::toggle_later(app),
            "pause" => {
                let paused = !crate::island::is_paused(app);
                crate::island::set_paused(app, paused);
                let _ = pause_item.set_text(if paused {
                    "Tampilkan notch"
                } else {
                    "Sembunyikan notch"
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::island::reveal(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
