//! Jendela notch: posisi di tengah atas layar, click-through di luar area
//! pulau, dan deteksi hover dari posisi kursor global.
//!
//! Frontend yang ngatur bentuk pulau (kecil, peek, melebar) lalu ngirim
//! kotak area-nya lewat `island_set_hit`. Rust cuma jagain dua hal:
//! klik di luar kotak itu diteruskan ke app di bawahnya, dan frontend
//! dikabarin tiap kursor masuk atau keluar kotak.

use serde::Deserialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

#[derive(Clone, Copy, Deserialize, Default, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Default)]
pub struct IslandState {
    /// Kotak pulau dalam satuan logis, relatif ke pojok kiri atas jendela.
    pub hit: Mutex<Rect>,
    /// Notch disembunyikan lewat tray.
    pub paused: AtomicBool,
    /// Kotak pulau baru berubah: status click-through perlu dihitung ulang.
    pub resync: AtomicBool,
}

const POLL: Duration = Duration::from_millis(30);
/// Area pemicu ekstra di sekitar pulau, biar gampang dikenai kursor.
const MARGIN: f64 = 6.0;

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Taruh jendela pas di tengah atas monitor utama.
fn place(win: &WebviewWindow) {
    let monitor = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, win.outer_size()) else {
        return;
    };
    let screen = monitor.size();
    let origin = monitor.position();
    let x = origin.x + (screen.width as i32 - size.width as i32) / 2;
    let y = origin.y;
    if win.outer_position().map(|p| p.x != x || p.y != y).unwrap_or(true) {
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

fn cursor_inside(win: &WebviewWindow, rect: Rect) -> bool {
    if rect.w <= 0.0 || rect.h <= 0.0 {
        return false;
    }
    let (Ok(cursor), Ok(pos), Ok(scale)) =
        (win.cursor_position(), win.outer_position(), win.scale_factor())
    else {
        return false;
    };
    let left = pos.x as f64 + (rect.x - MARGIN) * scale;
    let top = pos.y as f64 + (rect.y - MARGIN).max(0.0) * scale;
    let right = pos.x as f64 + (rect.x + rect.w + MARGIN) * scale;
    let bottom = pos.y as f64 + (rect.y + rect.h + MARGIN) * scale;
    // Ujung paling atas layar selalu dihitung masuk, biar kursor yang
    // "nabrak" atas layar tetap kena walaupun notch-nya tipis.
    let top = top.min(pos.y as f64);
    cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(win) = main_window(app) else {
        return Ok(());
    };
    place(&win);
    let _ = win.set_ignore_cursor_events(true);
    win.show()?;
    start_watcher(app.clone(), win);
    Ok(())
}

fn start_watcher(app: AppHandle, win: WebviewWindow) {
    thread::spawn(move || {
        let mut inside = false;
        let mut hidden_for_fullscreen = false;
        let mut last_slow_check = Instant::now() - Duration::from_secs(10);
        let own_hwnd = window_handle(&win);

        loop {
            let state = app.state::<IslandState>();

            // Dicek tiap ~600ms: monitor berubah, app fullscreen.
            if last_slow_check.elapsed() > Duration::from_millis(600) {
                last_slow_check = Instant::now();
                place(&win);

                let settings = crate::settings::current(&app);
                let paused = state.paused.load(Ordering::Relaxed);
                let fullscreen = settings.hide_in_fullscreen && foreground_is_fullscreen(own_hwnd);
                let should_hide = paused || fullscreen;
                if should_hide != hidden_for_fullscreen {
                    hidden_for_fullscreen = should_hide;
                    if should_hide {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                    }
                    let _ = app.emit("island-visibility", !should_hide);
                }
            }

            if hidden_for_fullscreen {
                if inside {
                    inside = false;
                    let _ = win.set_ignore_cursor_events(true);
                    let _ = app.emit("island-hover", false);
                }
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            let rect = *state.hit.lock().unwrap();
            let now_inside = cursor_inside(&win, rect);
            if state.resync.swap(false, Ordering::Relaxed) {
                let _ = win.set_ignore_cursor_events(!now_inside);
            }
            if now_inside != inside {
                inside = now_inside;
                let _ = win.set_ignore_cursor_events(!inside);
                let _ = app.emit("island-hover", inside);
            }
            thread::sleep(POLL);
        }
    });
}

/// Munculin notch lagi dan buka pulaunya (dari tray atau instance kedua).
pub fn reveal(app: &AppHandle) {
    app.state::<IslandState>().paused.store(false, Ordering::Relaxed);
    if let Some(win) = main_window(app) {
        let _ = win.show();
    }
    let _ = app.emit("island-open", "home");
}

/// Shortcut global: buka chat dan fokusin kolom ketik.
pub fn toggle_chat(app: &AppHandle) {
    app.state::<IslandState>().paused.store(false, Ordering::Relaxed);
    if let Some(win) = main_window(app) {
        let _ = win.show();
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_focus();
    }
    let _ = app.emit("island-toggle-chat", ());
}

pub fn set_paused(app: &AppHandle, paused: bool) {
    app.state::<IslandState>().paused.store(paused, Ordering::Relaxed);
}

pub fn is_paused(app: &AppHandle) -> bool {
    app.state::<IslandState>().paused.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn island_set_hit(state: State<IslandState>, rect: Rect) {
    *state.hit.lock().unwrap() = rect;
    state.resync.store(true, Ordering::Relaxed);
}

/// Dipanggil frontend pas kolom chat diklik, biar keyboard masuk ke notch.
#[tauri::command]
pub fn island_focus(app: AppHandle) {
    if let Some(win) = main_window(&app) {
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_focus();
    }
}

// ---------------------------------------------------------------------------
// Deteksi app fullscreen (Windows)
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn window_handle(win: &WebviewWindow) -> isize {
    win.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
fn window_handle(_win: &WebviewWindow) -> isize {
    0
}

#[cfg(windows)]
fn foreground_is_fullscreen(own: isize) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, GWL_STYLE, WS_CAPTION,
    };

    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() || fg.0 as isize == own {
            return false;
        }

        // Desktop dan taskbar bukan "app fullscreen".
        let mut class = [0u16; 64];
        let len = GetClassNameW(fg, &mut class);
        let class = String::from_utf16_lossy(&class[..len.max(0) as usize]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
            return false;
        }

        // Jendela biasa yang dimaksimalkan masih punya title bar.
        let style = GetWindowLongW(fg, GWL_STYLE) as u32;
        if style & WS_CAPTION.0 == WS_CAPTION.0 {
            return false;
        }

        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return false;
        }
        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

#[cfg(not(windows))]
fn foreground_is_fullscreen(_own: isize) -> bool {
    false
}
