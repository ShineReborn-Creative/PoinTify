//! Pip di desktop: jendela kecil transparan yang bisa di-drag ke mana aja.
//!
//! - Ditarik keluar dari notch (atau dinyalain dari Pengaturan/tray), Pip
//!   pindah ke jendela sendiri dan diem di tempat lu naruh dia.
//! - Kadang jalan-jalan dikit ke kiri/kanan kalau lagi santai.
//! - Ada notif di notch: Pip terbang ke sebelah notch, abis itu balik lagi.
//! - Ditaruh balik ke notch (di-drag ke tengah atas layar): pulang.
//!
//! Sama kayak notch, jendela ini tembus klik di luar badan Pip. Rust ngecek
//! posisi kursor dan baru "nangkep" mouse kalau kursor ada di atas Pip.

use crate::island::Rect;
use serde::Serialize;
use std::{
    hash::{BuildHasher, Hasher},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

pub const LABEL: &str = "pet";
/// Ukuran jendela (logis). Pip-nya lebih kecil, sisanya buat partikel.
const W: f64 = 150.0;
const H: f64 = 150.0;
const POLL: Duration = Duration::from_millis(30);
const CURSOR_EVERY: Duration = Duration::from_millis(50);

#[derive(Default)]
pub struct PetState {
    hit: Mutex<Rect>,
    carrying: AtomicBool,
    drop_now: AtomicBool,
    moving: AtomicBool,
    watching: AtomicBool,
    /// Posisi asal waktu Pip lagi mampir ke notch buat notif.
    away_from: Mutex<Option<(i32, i32)>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CarryResult {
    moved: bool,
    /// Ditaruh di area notch: Pip pulang.
    home: bool,
}

#[derive(Serialize, Clone)]
struct Moving {
    moving: bool,
    /// -1 ke kiri, 1 ke kanan, 0 diem.
    dir: i32,
}

#[derive(Serialize, Clone, Copy)]
struct CursorPos {
    x: f64,
    y: f64,
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn rand_unit() -> f64 {
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(Instant::now().elapsed().as_nanos());
    (h.finish() % 10_000) as f64 / 10_000.0
}

// ---------------------------------------------------------------------------
// Bikin, tampilkan, tutup
// ---------------------------------------------------------------------------

/// Posisi awal: tempat terakhir Pip ditaruh, atau pojok kanan bawah layar utama.
fn initial_position(app: &AppHandle) -> Option<(i32, i32)> {
    if let Some([x, y]) = crate::settings::current(app).pet_pos {
        // Pastiin masih ada di salah satu layar (monitor bisa dicabut).
        if app.monitor_from_point(x as f64 + 40.0, y as f64 + 40.0).ok().flatten().is_some() {
            return Some((x, y));
        }
    }
    let monitor = app.primary_monitor().ok().flatten()?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let x = area.position.x + area.size.width as i32 - ((W + 60.0) * scale) as i32;
    let y = area.position.y + area.size.height as i32 - ((H + 10.0) * scale) as i32;
    Some((x, y))
}

fn ensure_window(app: &AppHandle, at: Option<(i32, i32)>) -> tauri::Result<WebviewWindow> {
    if let Some(win) = window(app) {
        win.show()?;
        return Ok(win);
    }
    let win = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("index.html".into()))
        .title("Pip")
        .inner_size(W, H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .disable_drag_drop_handler()
        .build()?;
    if let Some((x, y)) = at.or_else(|| initial_position(app)) {
        win.set_position(PhysicalPosition::new(x, y))?;
    }
    win.show()?;
    let _ = win.set_ignore_cursor_events(true);
    start_watcher(app.clone());
    Ok(win)
}

fn set_mode(app: &AppHandle, on: bool) {
    crate::settings::update(app, |s| s.pet_mode = on);
    let _ = app.emit("pet-mode", on);
}

fn save_position(app: &AppHandle, win: &WebviewWindow) {
    if let Ok(p) = win.outer_position() {
        crate::settings::update(app, |s| s.pet_pos = Some([p.x, p.y]));
    }
}

/// Dipanggil pas aplikasi nyala: kalau terakhir Pip lagi di desktop, keluarin lagi.
pub fn restore_later(app: &AppHandle) {
    if !crate::settings::current(app).pet_mode {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = ensure_window(&app, None) {
            eprintln!("[pointify] Pip desktop gagal dibuka: {e}");
        }
    });
}

/// Dari menu tray (thread utama): pindahin ke thread lain biar WebView2 nggak macet.
pub fn toggle_later(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if window(&app).is_some() {
            go_home(&app);
        } else if ensure_window(&app, None).is_ok() {
            set_mode(&app, true);
        }
    });
}

/// Pengaturan "Pip di desktop" diubah dari jendela pengaturan.
pub fn apply_mode_later(app: &AppHandle, on: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match (on, window(&app).is_some()) {
            (true, false) => {
                if let Err(e) = ensure_window(&app, None) {
                    eprintln!("[pointify] Pip desktop gagal dibuka: {e}");
                }
            }
            (false, true) => {
                let _ = tauri::async_runtime::spawn_blocking(move || go_home(&app)).await;
            }
            _ => {}
        }
    });
}

/// Terbang ke notch, lalu jendelanya ditutup.
fn go_home(app: &AppHandle) {
    if let Some(win) = window(app) {
        if let Some(home) = notch_spot(app, 0) {
            fly(app, &win, home, 520);
        }
        let _ = win.close();
    }
    set_mode(app, false);
}

/// Titik di tengah atas layar utama, digeser `offset` px logis ke kanan.
fn notch_spot(app: &AppHandle, offset: i32) -> Option<(i32, i32)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let cx = pos.x + size.width as i32 / 2;
    let x = cx + (offset as f64 * scale) as i32 - (W * scale / 2.0) as i32;
    Some((x, pos.y - (12.0 * scale) as i32))
}

fn in_notch_zone(app: &AppHandle, cx: f64, cy: f64) -> bool {
    // Notch bisa digeser: pakai kotak pulau yang sekarang.
    if let Some((x, y, w, h)) = crate::island::island_screen_rect(app, 40.0) {
        return cx >= x as f64 && cx <= (x + w) as f64 && cy >= y as f64 - 4.0 && cy <= (y + h) as f64;
    }
    let Some(monitor) = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| app.monitor_from_point(cx, cy).ok().flatten())
    else {
        return false;
    };
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let center = pos.x as f64 + monitor.size().width as f64 / 2.0;
    (cx - center).abs() < 200.0 * scale && cy - (pos.y as f64) < 70.0 * scale
}

/// Jaga biar jendela tetap di dalam area kerja layar (nggak ketutup taskbar).
fn clamp_to_screen(app: &AppHandle, x: i32, y: i32) -> (i32, i32) {
    let probe = (x as f64 + W / 2.0, y as f64 + H / 2.0);
    let Some(monitor) = app
        .monitor_from_point(probe.0, probe.1)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
    else {
        return (x, y);
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let (w, h) = ((W * scale) as i32, (H * scale) as i32);
    let min_x = area.position.x - w / 4;
    let max_x = area.position.x + area.size.width as i32 - w + w / 4;
    let min_y = area.position.y - h / 4;
    let max_y = area.position.y + area.size.height as i32 - h + (h as f64 * 0.12) as i32;
    (x.clamp(min_x, max_x.max(min_x)), y.clamp(min_y, max_y.max(min_y)))
}

// ---------------------------------------------------------------------------
// Gerak
// ---------------------------------------------------------------------------

/// Pindahin jendela pelan-pelan (ease-in-out). Ngeblok sampai selesai.
fn fly(app: &AppHandle, win: &WebviewWindow, to: (i32, i32), ms: u64) {
    let state = app.state::<PetState>();
    let Ok(from) = win.outer_position() else { return };
    let dir = (to.0 - from.x).signum();
    state.moving.store(true, Ordering::Relaxed);
    let _ = app.emit_to(LABEL, "pet-moving", Moving { moving: true, dir });
    let start = Instant::now();
    let total = Duration::from_millis(ms.max(1));
    loop {
        if state.carrying.load(Ordering::Relaxed) {
            break;
        }
        let t = (start.elapsed().as_secs_f64() / total.as_secs_f64()).min(1.0);
        let e = if t < 0.5 { 4.0 * t * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(3) / 2.0 };
        let x = from.x as f64 + (to.0 - from.x) as f64 * e;
        let y = from.y as f64 + (to.1 - from.y) as f64 * e;
        let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
        if t >= 1.0 {
            break;
        }
        thread::sleep(Duration::from_millis(14));
    }
    state.moving.store(false, Ordering::Relaxed);
    let _ = app.emit_to(LABEL, "pet-moving", Moving { moving: false, dir: 0 });
}

#[cfg(windows)]
fn left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
    // Di luar Windows, frontend yang ngabarin lewat `pet_drop`.
    true
}

/// Jendela ngikutin kursor sampai tombol kiri mouse dilepas.
/// `grab`: titik pegangan di dalam jendela (piksel fisik); None = posisi kursor sekarang.
fn carry(app: &AppHandle, win: &WebviewWindow, grab: Option<(f64, f64)>) -> CarryResult {
    let state = app.state::<PetState>();
    state.drop_now.store(false, Ordering::Relaxed);
    state.carrying.store(true, Ordering::Relaxed);
    let _ = win.set_ignore_cursor_events(false);
    let _ = app.emit_to(LABEL, "pet-carry", true);

    let start_cursor = app.cursor_position().ok();
    let (gx, gy) = match (grab, start_cursor, win.outer_position()) {
        (Some(g), _, _) => g,
        (None, Some(c), Ok(p)) => (c.x - p.x as f64, c.y - p.y as f64),
        _ => (W / 2.0, H / 2.0),
    };
    let started = Instant::now();
    let mut moved = false;
    let mut last = start_cursor;
    loop {
        let Ok(c) = app.cursor_position() else { break };
        if let Some(s) = start_cursor {
            if (c.x - s.x).abs() + (c.y - s.y).abs() > 6.0 {
                moved = true;
            }
        }
        if last.map(|l| l.x != c.x || l.y != c.y).unwrap_or(true) {
            let _ = win.set_position(PhysicalPosition::new((c.x - gx).round() as i32, (c.y - gy).round() as i32));
            last = Some(c);
        }
        let released = !left_button_down() || state.drop_now.load(Ordering::Relaxed);
        if released || started.elapsed() > Duration::from_secs(120) {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }

    state.carrying.store(false, Ordering::Relaxed);
    let _ = app.emit_to(LABEL, "pet-carry", false);
    let home = moved && last.is_some_and(|c| in_notch_zone(app, c.x, c.y));
    if moved {
        // Dipindahin manual pas lagi mampir ke notch: tempat barunya yang dipakai.
        *state.away_from.lock().unwrap() = None;
    }
    if moved && !home {
        if let Ok(p) = win.outer_position() {
            let (x, y) = clamp_to_screen(app, p.x, p.y);
            if (x, y) != (p.x, p.y) {
                fly(app, win, (x, y), 220);
            }
        }
        save_position(app, win);
    }
    CarryResult { moved, home }
}

// ---------------------------------------------------------------------------
// Pantauan: kursor, tembus klik, app fullscreen
// ---------------------------------------------------------------------------

fn start_watcher(app: AppHandle) {
    if app.state::<PetState>().watching.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(move || {
        let mut inside = false;
        let mut hidden = false;
        let mut last_slow = Instant::now() - Duration::from_secs(10);
        let mut last_cursor = (f64::NAN, f64::NAN);
        let mut last_sent = Instant::now();
        loop {
            let Some(win) = window(&app) else { break };
            let state = app.state::<PetState>();

            if last_slow.elapsed() > Duration::from_millis(600) {
                last_slow = Instant::now();
                let settings = crate::settings::current(&app);
                let own = crate::island::window_handle(&win);
                let hide = crate::island::is_paused(&app)
                    || (settings.hide_in_fullscreen && crate::island::foreground_is_fullscreen(own));
                if hide != hidden {
                    hidden = hide;
                    let _ = if hide { win.hide() } else { win.show() };
                }
            }
            if hidden {
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            let (Ok(cursor), Ok(pos), Ok(scale)) = (app.cursor_position(), win.outer_position(), win.scale_factor())
            else {
                thread::sleep(POLL);
                continue;
            };
            let rel = ((cursor.x - pos.x as f64) / scale, (cursor.y - pos.y as f64) / scale);

            // Mata Pip ngikutin kursor.
            if last_sent.elapsed() >= CURSOR_EVERY
                && ((rel.0 - last_cursor.0).abs() >= 2.0 || (rel.1 - last_cursor.1).abs() >= 2.0 || last_cursor.0.is_nan())
            {
                last_cursor = rel;
                last_sent = Instant::now();
                let _ = app.emit_to(LABEL, "cursor-pos", CursorPos { x: rel.0, y: rel.1 });
            }

            // Tembus klik di luar badan Pip.
            let r = *state.hit.lock().unwrap();
            let now_inside = state.carrying.load(Ordering::Relaxed)
                || (r.w > 0.0 && rel.0 >= r.x - 4.0 && rel.0 <= r.x + r.w + 4.0 && rel.1 >= r.y - 4.0 && rel.1 <= r.y + r.h + 4.0);
            if now_inside != inside {
                inside = now_inside;
                let _ = win.set_ignore_cursor_events(!inside);
                let _ = app.emit_to(LABEL, "pet-hover", inside);
            }
            thread::sleep(POLL);
        }
        app.state::<PetState>().watching.store(false, Ordering::Relaxed);
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Nyalain Pip di desktop di tempat terakhir.
#[tauri::command]
pub async fn pet_show(app: AppHandle) -> Result<(), String> {
    ensure_window(&app, None).map_err(|e| e.to_string())?;
    set_mode(&app, true);
    Ok(())
}

/// Pip ditarik keluar dari notch: bikin jendelanya pas di bawah kursor,
/// lalu langsung ikut kursor sampai mouse dilepas.
#[tauri::command]
pub async fn pet_spawn_carry(app: AppHandle) -> Result<CarryResult, String> {
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let scale = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let grab = (W * scale / 2.0, H * scale * 0.55);
    let at = ((cursor.x - grab.0) as i32, (cursor.y - grab.1) as i32);
    let win = ensure_window(&app, Some(at)).map_err(|e| e.to_string())?;
    set_mode(&app, true);
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || carry(&app2, &win, Some(grab)))
        .await
        .map_err(|e| e.to_string())?;
    if result.home {
        let app3 = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || go_home(&app3)).await;
    }
    Ok(result)
}

/// Pip di desktop dipegang: ikutin kursor sampai dilepas.
/// `grab_x/grab_y`: titik yang dipegang di dalam jendela (px logis), dari
/// pointerdown, biar Pip nggak "loncat" walau command-nya telat nyampe.
#[tauri::command]
pub async fn pet_carry(app: AppHandle, grab_x: Option<f64>, grab_y: Option<f64>) -> Result<CarryResult, String> {
    let win = window(&app).ok_or("Pip lagi nggak di desktop")?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let grab = grab_x.zip(grab_y).map(|(x, y)| (x * scale, y * scale));
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || carry(&app2, &win, grab))
        .await
        .map_err(|e| e.to_string())?;
    if result.home {
        let app3 = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || go_home(&app3)).await;
    }
    Ok(result)
}

/// Cadangan buat sistem yang nggak bisa baca tombol mouse global.
#[tauri::command]
pub fn pet_drop(state: State<PetState>) {
    state.drop_now.store(true, Ordering::Relaxed);
}

/// Pulang ke notch.
#[tauri::command]
pub async fn pet_home(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || go_home(&app)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pet_set_hit(state: State<PetState>, rect: Rect) {
    *state.hit.lock().unwrap() = rect;
}

/// Jalan-jalan dikit ke kiri atau kanan. Balikin arah geraknya.
#[tauri::command]
pub async fn pet_wander(app: AppHandle) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PetState>();
        let win = window(&app).ok_or("Pip lagi nggak di desktop")?;
        if state.carrying.load(Ordering::Relaxed)
            || state.moving.load(Ordering::Relaxed)
            || state.away_from.lock().unwrap().is_some()
        {
            return Ok(0);
        }
        let pos = win.outer_position().map_err(|e| e.to_string())?;
        let scale = win.scale_factor().unwrap_or(1.0);
        let dist = (70.0 + rand_unit() * 150.0) * scale;
        let dir = if rand_unit() < 0.5 { -1 } else { 1 };
        let mut target = clamp_to_screen(&app, pos.x + (dist as i32) * dir, pos.y);
        // Mentok di pinggir layar: balik arah.
        if (target.0 - pos.x).abs() < (20.0 * scale) as i32 {
            target = clamp_to_screen(&app, pos.x - (dist as i32) * dir, pos.y);
        }
        let real_dir = (target.0 - pos.x).signum();
        if real_dir == 0 {
            return Ok(0);
        }
        let ms = (900.0 + dist / scale * 4.0) as u64;
        fly(&app, &win, target, ms);
        save_position(&app, &win);
        Ok(real_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ada notif di notch: Pip mampir ke sebelah notch.
#[tauri::command]
pub async fn pet_visit(app: AppHandle, offset: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PetState>();
        let Some(win) = window(&app) else { return };
        if state.carrying.load(Ordering::Relaxed) {
            return;
        }
        let mut away = state.away_from.lock().unwrap();
        if away.is_none() {
            if let Ok(p) = win.outer_position() {
                *away = Some((p.x, p.y));
            }
        }
        drop(away);
        if let Some(spot) = notch_spot(&app, offset) {
            fly(&app, &win, spot, 650);
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Notif beres: balik ke tempat semula.
#[tauri::command]
pub async fn pet_return(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PetState>();
        let Some(win) = window(&app) else { return };
        let from = state.away_from.lock().unwrap().take();
        if let Some(p) = from {
            if !state.carrying.load(Ordering::Relaxed) {
                fly(&app, &win, p, 700);
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}
