mod media;

use std::{thread, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewWindow};

const WIN_W: f64 = 420.0;
const COLLAPSED: (f64, f64) = (180.0, 32.0);
const EXPANDED: (f64, f64) = (400.0, 180.0);

fn cursor_inside(win: &WebviewWindow, (w, h): (f64, f64)) -> bool {
    let (Ok(cursor), Ok(pos), Ok(scale)) =
        (win.cursor_position(), win.outer_position(), win.scale_factor())
    else {
        return false;
    };
    let left = pos.x as f64 + (WIN_W - w) / 2.0 * scale;
    let top = pos.y as f64;
    cursor.x >= left
        && cursor.x <= left + w * scale
        && cursor.y >= top
        && cursor.y <= top + h * scale
}

fn start_hover_watcher(win: WebviewWindow) {
    thread::spawn(move || {
        let mut expanded = false;
        let _ = win.set_ignore_cursor_events(true);
        loop {
            let area = if expanded { EXPANDED } else { COLLAPSED };
            let inside = cursor_inside(&win, area);
            if inside != expanded {
                expanded = inside;
                let _ = win.set_ignore_cursor_events(!expanded);
                let _ = win.emit("notch-hover", expanded);
            }
            thread::sleep(Duration::from_millis(30));
        }
    });
}

#[cfg_attr(mobile, mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(media::MediaState::default())
        .setup(|app| {
            let win = app.get_webview_window("main").unwrap();
            if let Some(monitor) = win.current_monitor()? {
                let screen = monitor.size();
                let size = win.outer_size()?;
                let x = monitor.position().x + (screen.width as i32 - size.width as i32) / 2;
                let y = monitor.position().y;
                win.set_position(PhysicalPosition::new(x, y))?;
            }
            start_hover_watcher(win.clone());
            media::start_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![media::media_get, media::media_control])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}