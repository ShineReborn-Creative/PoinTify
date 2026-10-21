//! Ikon di system tray: buka notch, chat, pengaturan, sembunyikan, keluar.

use crate::i18n::tr;
use std::sync::Mutex;
use tauri::{
    AppHandle, Wry,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Item menu yang teksnya perlu diganti pas bahasa diubah.
static ITEMS: Mutex<Vec<(&'static str, MenuItem<Wry>)>> = Mutex::new(Vec::new());

fn label(id: &str, paused: bool) -> &'static str {
    match id {
        "open" => tr("Buka PoinTify", "Open PoinTify"),
        "chat" => tr("Chat dengan Claude", "Chat with Claude"),
        "settings" => tr("Pengaturan…", "Settings…"),
        "pause" if paused => tr("Tampilkan notch", "Show notch"),
        "pause" => tr("Sembunyikan notch", "Hide notch"),
        "pet" => tr("Pip di desktop: keluar/masuk", "Pip on desktop: in/out"),
        "quit" => tr("Keluar", "Quit"),
        _ => "",
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &'static str, accel: Option<&str>| MenuItem::with_id(app, id, label(id, false), true, accel);
    let open = item("open", None)?;
    let chat = item("chat", Some("Ctrl+Alt+P"))?;
    let settings = item("settings", None)?;
    let pause = item("pause", None)?;
    let pet = item("pet", None)?;
    let quit = item("quit", None)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &chat, &settings, &sep1, &pet, &pause, &sep2, &quit])?;
    *ITEMS.lock().unwrap() = vec![
        ("open", open.clone()),
        ("chat", chat.clone()),
        ("settings", settings.clone()),
        ("pause", pause.clone()),
        ("pet", pet.clone()),
        ("quit", quit.clone()),
    ];

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
                let _ = pause_item.set_text(label("pause", paused));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::island::reveal(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Bahasa diganti: ganti teks menu tray.
pub fn relabel(app: &AppHandle) {
    let paused = crate::island::is_paused(app);
    for (id, item) in ITEMS.lock().unwrap().iter() {
        let _ = item.set_text(label(id, paused));
    }
}
