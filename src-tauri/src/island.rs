//! Jendela notch: posisi di tengah atas layar, click-through di luar area
//! pulau, dan deteksi hover dari posisi kursor global.
//!
//! Frontend yang ngatur bentuk pulau (kecil, peek, melebar) lalu ngirim
//! kotak area-nya lewat `island_set_hit`. Rust cuma jagain dua hal:
//! klik di luar kotak itu diteruskan ke app di bawahnya, dan frontend
//! dikabarin tiap kursor masuk atau keluar kotak.

use serde::{Deserialize, Serialize};
use std::{
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

#[derive(Clone, Copy, Deserialize, Default, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Serialize)]
struct CursorPos {
    x: f64,
    y: f64,
}

#[derive(Default)]
pub struct IslandState {
    /// Kotak pulau dalam satuan logis, relatif ke pojok kiri atas jendela.
    pub hit: Mutex<Rect>,
    /// Notch disembunyikan lewat tray.
    pub paused: AtomicBool,
    /// Kotak pulau baru berubah: status click-through perlu dihitung ulang.
    pub resync: AtomicBool,
    /// Posisi & skala jendela terakhir yang dicatet.
    pub frame: Mutex<Option<Frame>>,
}

const POLL: Duration = Duration::from_millis(30);
/// Area pemicu ekstra di sekitar pulau, biar gampang dikenai kursor.
const MARGIN: f64 = 6.0;
/// Jeda minimal antar kiriman posisi kursor ke frontend (buat mata Pip).
const CURSOR_EVERY: Duration = Duration::from_millis(50);

/// Posisi & skala jendela notch. Nanya ke jendela itu lewat thread utama
/// (mahal kalau tiap 30 ms), jadi dicatet ulang tiap pengecekan lambat aja.
#[derive(Clone, Copy, Default, Debug)]
pub(crate) struct Frame {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

fn frame_of(win: &WebviewWindow) -> Option<Frame> {
    let pos = win.outer_position().ok()?;
    let scale = win.scale_factor().ok()?;
    Some(Frame { x: pos.x as f64, y: pos.y as f64, scale })
}

/// Posisi kursor di layar (px fisik). Di Windows langsung dari sistem (murah,
/// nggak lewat thread utama aplikasi).
#[cfg(windows)]
pub(crate) fn cursor_screen(_app: &AppHandle) -> Option<(f64, f64)> {
    use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x as f64, p.y as f64))
}

#[cfg(not(windows))]
pub(crate) fn cursor_screen(app: &AppHandle) -> Option<(f64, f64)> {
    app.cursor_position().ok().map(|c| (c.x, c.y))
}

/// Posisi kursor dalam satuan logis relatif ke pojok kiri atas jendela,
/// sama kayak `clientX/clientY` di webview.
fn cursor_in_window(f: Frame, c: (f64, f64)) -> CursorPos {
    CursorPos { x: (c.0 - f.x) / f.scale, y: (c.1 - f.y) / f.scale }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Tinggi jendela notch (logis). Lebarnya selebar layar, biar pulau bisa
/// digeser kanan-kiri dengan animasi CSS. Area di luar pulau tetap tembus klik.
const WINDOW_H: f64 = 460.0;

/// Taruh jendela di atas monitor utama, selebar layarnya.
fn place(win: &WebviewWindow) {
    let monitor = win.primary_monitor().ok().flatten().or_else(|| win.current_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let screen = monitor.size();
    let origin = monitor.position();
    let want = PhysicalSize::new(screen.width, (WINDOW_H * monitor.scale_factor()).round() as u32);
    if win.outer_size().map(|s| s != want).unwrap_or(true) {
        let _ = win.set_size(want);
    }
    if win.outer_position().map(|p| p.x != origin.x || p.y != origin.y).unwrap_or(true) {
        let _ = win.set_position(PhysicalPosition::new(origin.x, origin.y));
    }
}

/// Kotak pulau sekarang dalam piksel fisik layar (dipakai Pip desktop).
pub fn island_screen_rect(app: &AppHandle, margin: f64) -> Option<(i32, i32, i32, i32)> {
    let state = app.state::<IslandState>();
    let rect = *state.hit.lock().unwrap();
    let frame = (*state.frame.lock().unwrap()).or_else(|| main_window(app).and_then(|w| frame_of(&w)))?;
    screen_rect(frame, rect, margin)
}

/// Kotak pulau (plus `margin` px logis) dalam piksel fisik layar: (x, y, w, h).
fn screen_rect(f: Frame, rect: Rect, margin: f64) -> Option<(i32, i32, i32, i32)> {
    if rect.w <= 0.0 || rect.h <= 0.0 {
        return None;
    }
    let x = f.x + (rect.x - margin) * f.scale;
    let y = f.y + (rect.y - margin).max(0.0) * f.scale;
    let w = (rect.w + margin * 2.0) * f.scale;
    let h = (rect.h + margin) * f.scale;
    Some((x.round() as i32, y.round() as i32, w.round() as i32, h.round() as i32))
}

fn cursor_in_screen_rect(c: (f64, f64), r: (i32, i32, i32, i32)) -> bool {
    c.0 >= r.0 as f64 && c.0 <= (r.0 + r.2) as f64 && c.1 >= r.1 as f64 - 2.0 && c.1 <= (r.1 + r.3) as f64
}

fn cursor_inside(f: Frame, c: (f64, f64), rect: Rect) -> bool {
    if rect.w <= 0.0 || rect.h <= 0.0 {
        return false;
    }
    let left = f.x + (rect.x - MARGIN) * f.scale;
    let top = f.y + (rect.y - MARGIN).max(0.0) * f.scale;
    let right = f.x + (rect.x + rect.w + MARGIN) * f.scale;
    let bottom = f.y + (rect.y + rect.h + MARGIN) * f.scale;
    // Ujung paling atas layar selalu dihitung masuk, biar kursor yang
    // "nabrak" atas layar tetap kena walaupun notch-nya tipis.
    let top = top.min(f.y);
    c.0 >= left && c.0 <= right && c.1 >= top && c.1 <= bottom
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
        let mut last_slow_check = crate::ago(Duration::from_secs(10));
        let own_hwnd = window_handle(&win);
        let mut last_cursor = CursorPos { x: f64::NAN, y: f64::NAN };
        // Buat penangkap file: tombol kiri mulai ditekan di luar notch?
        let mut was_down = false;
        let mut pressed_outside = false;
        let mut pressed_inside = false;
        let mut last_cursor_sent = Instant::now();
        let mut frame = frame_of(&win);

        loop {
            let state = app.state::<IslandState>();

            // Dicek tiap ~600ms: monitor berubah, app fullscreen.
            if last_slow_check.elapsed() > Duration::from_millis(600) {
                last_slow_check = Instant::now();
                place(&win);
                frame = frame_of(&win).or(frame);
                *state.frame.lock().unwrap() = frame;

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
                crate::drop_catcher::place(None);
                if inside {
                    inside = false;
                    let _ = win.set_ignore_cursor_events(true);
                    let _ = app.emit("island-hover", false);
                }
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            let (Some(f), Some(c)) = (frame, cursor_screen(&app)) else {
                thread::sleep(POLL);
                continue;
            };
            let rect = *state.hit.lock().unwrap();
            let raw_inside = cursor_inside(f, c, rect);

            // Tombol kiri: ditekan di dalam atau di luar notch?
            let down = crate::drop_catcher::left_button_down();
            if down && !was_down {
                pressed_outside = !raw_inside;
                pressed_inside = raw_inside;
            }
            if !down {
                pressed_outside = false;
                pressed_inside = false;
            }
            was_down = down;
            // Lagi nyeret notch (atau apa pun yang mulai dari dalam notch): jangan
            // dilepas jadi tembus klik walau kursor sempat keluar kotaknya.
            let now_inside = raw_inside || (down && pressed_inside);

            if state.resync.swap(false, Ordering::Relaxed) {
                let _ = win.set_ignore_cursor_events(!now_inside);
            }
            if now_inside != inside {
                inside = now_inside;
                let _ = win.set_ignore_cursor_events(!inside);
                let _ = app.emit("island-hover", inside);
            }

            // Ada yang diseret dari luar (misalnya file dari Explorer) ke atas notch:
            // pasang penangkap file native di atas pulau. Kalau ditekannya di dalam
            // notch (nyeret file keluar dari rak, nyeret Pip), penangkapnya nggak dipasang.
            let zone = screen_rect(f, rect, 24.0);
            let catch = zone.filter(|z| down && pressed_outside && cursor_in_screen_rect(c, *z));
            crate::drop_catcher::place(catch);

            // Buat mata Pip: kirim posisi kursor kalau geraknya kerasa.
            if last_cursor_sent.elapsed() >= CURSOR_EVERY {
                let c = cursor_in_window(f, c);
                let moved = (c.x - last_cursor.x).abs() >= 2.0 || (c.y - last_cursor.y).abs() >= 2.0;
                if moved || last_cursor.x.is_nan() {
                    last_cursor = c;
                    last_cursor_sent = Instant::now();
                    let _ = app.emit_to("main", "cursor-pos", c);
                }
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
pub(crate) fn window_handle(win: &WebviewWindow) -> isize {
    win.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}

#[cfg(not(windows))]
pub(crate) fn window_handle(_win: &WebviewWindow) -> isize {
    0
}

#[cfg(windows)]
pub(crate) fn foreground_is_fullscreen(own: isize) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_STYLE, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, WS_CAPTION,
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
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

#[cfg(not(windows))]
pub(crate) fn foreground_is_fullscreen(_own: isize) -> bool {
    false
}

/// Taruh jendela ini lagi di paling atas (tanpa ngerebut fokus). Dipakai Pip
/// pas nemenin app fullscreen: ada game yang naruh dirinya "selalu di atas"
/// juga, jadi urutannya perlu dipertegas sesekali.
#[cfg(windows)]
pub(crate) fn keep_on_top(own: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SetWindowPos};
    if own == 0 {
        return;
    }
    unsafe {
        let _ = SetWindowPos(
            HWND(own as *mut std::ffi::c_void),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER,
        );
    }
}

#[cfg(not(windows))]
pub(crate) fn keep_on_top(_own: isize) {}
