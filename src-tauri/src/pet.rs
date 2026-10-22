//! Pip di desktop: pet kecil yang hidup di atas semua jendela.
//!
//! - Ditarik keluar dari notch (atau dinyalain dari Pengaturan/tray), Pip
//!   pindah ke jendela sendiri.
//! - Ada gravitasi: Pip jatuh ke atas taskbar, bisa dilempar (mantul di
//!   pinggir layar), dan bisa nangkring di pinggir atas jendela lain. Kalau
//!   jendelanya digeser dia ikut, kalau ditutup dia jatuh.
//! - Jalan, lari, loncat, dan manjat pinggir layar. Kapan geraknya
//!   ditentuin frontend (yang tahu mood Pip), caranya dihitung di sini.
//! - Ada notif di notch: Pip terbang ke sebelah notch, abis itu balik lagi.
//! - Ditaruh balik ke notch (dilepas di area notch): pulang.
//!
//! Sama kayak notch, jendela ini tembus klik di luar badan Pip (dan papan
//! yang lagi dia pegang). Rust ngecek posisi kursor dan baru "nangkep" mouse
//! kalau kursor ada di atasnya.

use crate::island::Rect;
use serde::Serialize;
use std::{
    hash::{BuildHasher, Hasher},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

pub const LABEL: &str = "pet";
/// Ukuran jendela (logis). Pip-nya di bawah tengah; sisanya buat balon
/// omongan, papan, partikel, dan bola.
const W: f64 = 300.0;
const H: f64 = 230.0;
const POLL: Duration = Duration::from_millis(30);
const CURSOR_EVERY: Duration = Duration::from_millis(50);

// Fisika (px logis per detik; dikali skala layar pas dipakai).
const GRAVITY: f64 = 2600.0;
const WALK_SPEED: f64 = 70.0;
const RUN_SPEED: f64 = 210.0;
const CLIMB_SPEED: f64 = 120.0;
const MAX_THROW: f64 = 4200.0;

#[derive(Default)]
pub struct PetState {
    /// Badan Pip (px logis, relatif ke jendela).
    hit: Mutex<Rect>,
    /// Bagian lain yang bisa diklik (papan Live).
    extra: Mutex<Vec<Rect>>,
    carrying: AtomicBool,
    drop_now: AtomicBool,
    moving: AtomicBool,
    watching: AtomicBool,
    thinking: AtomicBool,
    /// Jendela Pip lagi disembunyiin (app fullscreen / PoinTify dijeda).
    hidden: AtomicBool,
    /// Pip lagi nemenin app fullscreen (game, film): keliatan, tapi tembus klik,
    /// nggak ngejar kursor, dan nggak mampir ke notch (notch-nya lagi sembunyi).
    fullscreen: AtomicBool,
    /// Posisi jendela terakhir yang dipasang PoinTify sendiri (px fisik).
    pos: Mutex<Option<(i32, i32)>>,
    /// Pip lagi santai dan boleh main sama kursor (ditentuin frontend).
    play_ok: AtomicBool,
    /// Main kejar-kejaran sampai jam segini.
    chase_until: Mutex<Option<Instant>>,
    /// Posisi asal waktu Pip lagi mampir ke notch buat notif.
    away_from: Mutex<Option<(i32, i32)>>,
    /// Kecepatan pas dilepas abis dipegang (px fisik/detik).
    throw: Mutex<Option<(f64, f64)>>,
    /// Perintah gerak dari frontend.
    order: Mutex<Option<String>>,
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

/// Kabar gerak buat animasi di frontend.
#[derive(Serialize, Clone)]
struct Motion {
    /// walk | run | jump | climb | cling | fall | thrown | bonk | bounce | land | perch | idle
    kind: &'static str,
    dir: i32,
    /// Seberapa keras (dipakai buat tumbukan), kira-kira 0..3.
    power: f64,
}

#[derive(Serialize, Clone, Copy)]
struct CursorPos {
    x: f64,
    y: f64,
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Pindahin jendela Pip dan catet posisinya (biar pemantau nggak perlu nanya
/// posisi ke jendela tiap 30 ms; nanya itu lewat thread utama dan mahal).
fn move_to(app: &AppHandle, win: &WebviewWindow, x: i32, y: i32) {
    let _ = win.set_position(PhysicalPosition::new(x, y));
    *app.state::<PetState>().pos.lock().unwrap() = Some((x, y));
}

/// Posisi kursor di layar (px fisik).
fn cursor(app: &AppHandle) -> Option<(f64, f64)> {
    crate::island::cursor_screen(app)
}

fn rand_unit() -> f64 {
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(Instant::now().elapsed().as_nanos());
    (h.finish() % 10_000) as f64 / 10_000.0
}

fn emit_motion(app: &AppHandle, kind: &'static str, dir: f64, power: f64) {
    let _ = app.emit_to(
        LABEL,
        "pet-motion",
        Motion { kind, dir: if dir == 0.0 { 0 } else { dir.signum() as i32 }, power: (power * 100.0).round() / 100.0 },
    );
}

// ---------------------------------------------------------------------------
// Bikin, tampilkan, tutup
// ---------------------------------------------------------------------------

/// Posisi awal: tempat terakhir Pip ditaruh, atau pojok kanan bawah layar utama.
fn initial_position(app: &AppHandle) -> Option<(i32, i32)> {
    if let Some([x, y]) = crate::settings::current(app).pet_pos {
        // Pastiin masih ada di salah satu layar (monitor bisa dicabut).
        if app.monitor_from_point(x as f64 + 80.0, y as f64 + 80.0).ok().flatten().is_some() {
            return Some((x, y));
        }
    }
    let monitor = app.primary_monitor().ok().flatten()?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let x = area.position.x + area.size.width as i32 - ((W + 40.0) * scale) as i32;
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
        *app.state::<PetState>().pos.lock().unwrap() = Some((x, y));
    }
    win.show()?;
    let _ = win.set_ignore_cursor_events(true);
    start_watcher(app.clone());
    start_brain(app.clone());
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
            let _ = tauri::async_runtime::spawn_blocking(move || go_home(&app)).await;
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

/// Posisi jendela biar badan Pip pas di sebelah notch (tengah atas layar utama,
/// digeser `offset` px logis ke kanan).
fn notch_spot(app: &AppHandle, offset: i32) -> Option<(i32, i32)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let size = monitor.size();
    let cx = pos.x + size.width as i32 / 2;
    let body = body_metrics(app, scale);
    let x = cx + (offset as f64 * scale) as i32 - body.cx as i32;
    // Kepala Pip pas di bawah garis atas layar.
    Some((x, pos.y - (body.top - 6.0 * scale) as i32))
}

fn in_notch_zone(app: &AppHandle, cx: f64, cy: f64) -> bool {
    // Notch bisa digeser: pakai kotak pulau yang sekarang.
    if let Some((x, y, w, h)) = crate::island::island_screen_rect(app, 40.0) {
        return cx >= x as f64 && cx <= (x + w) as f64 && cy >= y as f64 - 4.0 && cy <= (y + h) as f64;
    }
    let Some(monitor) = app.primary_monitor().ok().flatten().or_else(|| app.monitor_from_point(cx, cy).ok().flatten()) else {
        return false;
    };
    let scale = monitor.scale_factor();
    let pos = monitor.position();
    let center = pos.x as f64 + monitor.size().width as f64 / 2.0;
    (cx - center).abs() < 200.0 * scale && cy - (pos.y as f64) < 70.0 * scale
}

// ---------------------------------------------------------------------------
// Badan & layar
// ---------------------------------------------------------------------------

/// Letak badan Pip di dalam jendela (px fisik): tengah, atas, kaki, setengah lebar.
#[derive(Clone, Copy)]
struct Body {
    cx: f64,
    top: f64,
    feet: f64,
    half: f64,
}

fn body_metrics(app: &AppHandle, scale: f64) -> Body {
    let r = *app.state::<PetState>().hit.lock().unwrap();
    if r.w > 0.0 && r.h > 0.0 {
        Body {
            cx: (r.x + r.w / 2.0) * scale,
            top: r.y * scale,
            // Padding bawah badan ~4px, jadi kaki sedikit di atas kotaknya.
            feet: (r.y + r.h - 4.0) * scale,
            half: (r.w / 2.0 - 10.0).max(12.0) * scale,
        }
    } else {
        Body { cx: W / 2.0 * scale, top: (H - 120.0) * scale, feet: (H - 14.0) * scale, half: 30.0 * scale }
    }
}

/// Kotak (kiri, atas, kanan, bawah) dalam px fisik.
type Edges = (f64, f64, f64, f64);

/// Daftar layar (diambil ulang tiap 2 detik, bukan tiap frame).
struct Screens {
    /// (seluruh layar, area kerja).
    list: Vec<(Edges, Edges)>,
    at: Instant,
}

impl Screens {
    fn new() -> Self {
        Self { list: Vec::new(), at: crate::ago(Duration::from_secs(10)) }
    }

    fn refresh(&mut self, app: &AppHandle) {
        if self.at.elapsed() < Duration::from_secs(2) && !self.list.is_empty() {
            return;
        }
        self.at = Instant::now();
        let mons = app.available_monitors().unwrap_or_default();
        if mons.is_empty() {
            return;
        }
        self.list = mons
            .iter()
            .map(|m| {
                let (p, s) = (m.position(), m.size());
                let w = m.work_area();
                let full = (p.x as f64, p.y as f64, p.x as f64 + s.width as f64, p.y as f64 + s.height as f64);
                let (wl, wt) = (w.position.x as f64, w.position.y as f64);
                (full, (wl, wt, wl + w.size.width as f64, wt + w.size.height as f64))
            })
            .collect();
    }

    fn has(&self, x: f64, y: f64) -> bool {
        self.list.iter().any(|(f, _)| x >= f.0 && x < f.2 && y >= f.1 && y < f.3)
    }

    /// Area kerja layar yang berisi titik ini (atau yang paling deket).
    fn area(&self, x: f64, y: f64) -> Option<(f64, f64, f64, f64)> {
        if let Some((_, w)) = self.list.iter().find(|(f, _)| x >= f.0 && x < f.2 && y >= f.1 && y < f.3) {
            return Some(*w);
        }
        self.list
            .iter()
            .min_by(|a, b| {
                let d = |f: &(f64, f64, f64, f64)| (x - x.clamp(f.0, f.2)).abs() + (y - y.clamp(f.1, f.3)).abs();
                d(&a.0).total_cmp(&d(&b.0))
            })
            .map(|(_, w)| *w)
    }
}

// ---------------------------------------------------------------------------
// Jendela lain (buat tempat nangkring)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct WinBox {
    hwnd: isize,
    l: f64,
    t: f64,
    r: f64,
    b: f64,
    /// Lagi dimaksimalin: nutupin, tapi nggak bisa ditangkringin.
    max: bool,
}

#[cfg(windows)]
mod wins {
    use super::WinBox;
    use std::ffi::c_void;
    use windows::{
        Win32::{
            Foundation::{HWND, LPARAM, RECT},
            Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute},
            UI::WindowsAndMessaging::{
                EnumWindows, GWL_EXSTYLE, GWL_STYLE, GetClassNameW, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
                IsZoomed, WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
            },
        },
        core::BOOL,
    };

    const SKIP_CLASSES: [&str; 6] =
        ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "PoinTifyDropCatcher", "NotifyIconOverflowWindow"];

    pub fn boxed(raw: isize) -> Option<WinBox> {
        let h = HWND(raw as *mut c_void);
        unsafe {
            if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == std::process::id() {
                return None;
            }
            let style = GetWindowLongPtrW(h, GWL_STYLE) as u32;
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            if style & WS_CHILD.0 != 0 || ex & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0) != 0 {
                return None;
            }
            let mut cloaked = 0u32;
            if DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4).is_ok() && cloaked != 0 {
                return None;
            }
            let mut buf = [0u16; 64];
            let n = GetClassNameW(h, &mut buf) as usize;
            let class = String::from_utf16_lossy(&buf[..n.min(64)]);
            if SKIP_CLASSES.contains(&class.as_str()) {
                return None;
            }
            let mut r = RECT::default();
            DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32)
                .ok()?;
            let (w, hh) = (r.right - r.left, r.bottom - r.top);
            if w < 200 || hh < 120 {
                return None;
            }
            Some(WinBox { hwnd: raw, l: r.left as f64, t: r.top as f64, r: r.right as f64, b: r.bottom as f64, max: IsZoomed(h).as_bool() })
        }
    }

    unsafe extern "system" fn collect(h: HWND, lp: LPARAM) -> BOOL {
        let list = unsafe { &mut *(lp.0 as *mut Vec<WinBox>) };
        if let Some(b) = boxed(h.0 as isize) {
            list.push(b);
        }
        BOOL(1)
    }

    /// Jendela yang keliatan, urut dari paling depan.
    pub fn list() -> Vec<WinBox> {
        let mut v: Vec<WinBox> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut v as *mut Vec<WinBox> as isize));
        }
        v
    }
}

#[cfg(not(windows))]
mod wins {
    use super::WinBox;
    pub fn boxed(_raw: isize) -> Option<WinBox> {
        None
    }
    pub fn list() -> Vec<WinBox> {
        Vec::new()
    }
}

/// Jendela paling depan yang pinggir atasnya kelewatan kaki Pip pas jatuh
/// (dari `y0` ke `y1`) di posisi `x`, dan bagian itu nggak ketutup jendela lain.
fn perch_target(list: &[WinBox], x: f64, y0: f64, y1: f64, margin: f64, area_top: f64) -> Option<WinBox> {
    for (i, w) in list.iter().enumerate() {
        if w.max || x < w.l + margin || x > w.r - margin {
            continue;
        }
        if !(y0 <= w.t && y1 >= w.t) || w.t < area_top + margin {
            continue;
        }
        let covered = list[..i].iter().any(|o| x >= o.l && x <= o.r && w.t + 2.0 >= o.t && w.t + 2.0 <= o.b);
        if !covered {
            return Some(*w);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Gerak terprogram (notch)
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
        move_to(app, win, x.round() as i32, y.round() as i32);
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

/// Jendela ngikutin kursor sampai tombol kiri mouse dilepas. Kecepatan kursor
/// pas dilepas disimpen, jadi Pip bisa dilempar.
/// `grab`: titik pegangan di dalam jendela (piksel fisik); None = posisi kursor sekarang.
fn carry(app: &AppHandle, win: &WebviewWindow, grab: Option<(f64, f64)>) -> CarryResult {
    let state = app.state::<PetState>();
    state.drop_now.store(false, Ordering::Relaxed);
    *state.throw.lock().unwrap() = None;
    state.carrying.store(true, Ordering::Relaxed);
    let _ = win.set_ignore_cursor_events(false);
    let _ = app.emit_to(LABEL, "pet-carry", true);

    let start_cursor = cursor(app).map(|(x, y)| PhysicalPosition::new(x, y));
    let (gx, gy) = match (grab, start_cursor, win.outer_position()) {
        (Some(g), _, _) => g,
        (None, Some(c), Ok(p)) => (c.x - p.x as f64, c.y - p.y as f64),
        _ => (W / 2.0, H / 2.0),
    };
    let started = Instant::now();
    let mut moved = false;
    let mut last = start_cursor;
    // Jejak kursor 120 ms terakhir buat ngitung kecepatan lemparan.
    let mut trail: Vec<(Instant, f64, f64)> = Vec::new();
    while let Some(c) = cursor(app).map(|(x, y)| PhysicalPosition::new(x, y)) {
        if let Some(s) = start_cursor
            && (c.x - s.x).abs() + (c.y - s.y).abs() > 6.0
        {
            moved = true;
        }
        let now = Instant::now();
        trail.push((now, c.x, c.y));
        trail.retain(|(t, _, _)| now.duration_since(*t) < Duration::from_millis(120));
        if last.map(|l| l.x != c.x || l.y != c.y).unwrap_or(true) {
            move_to(app, win, (c.x - gx).round() as i32, (c.y - gy).round() as i32);
            last = Some(c);
        }
        let released = !left_button_down() || state.drop_now.load(Ordering::Relaxed);
        if released || started.elapsed() > Duration::from_secs(120) {
            break;
        }
        thread::sleep(Duration::from_millis(8));
    }

    let home = moved && last.is_some_and(|c| in_notch_zone(app, c.x, c.y));
    if moved {
        // Dipindahin manual pas lagi mampir ke notch: tempat barunya yang dipakai.
        *state.away_from.lock().unwrap() = None;
        if !home {
            let v = match (trail.first(), trail.last()) {
                (Some(a), Some(b)) if b.0.duration_since(a.0) > Duration::from_millis(15) => {
                    let dt = b.0.duration_since(a.0).as_secs_f64();
                    ((b.1 - a.1) / dt, (b.2 - a.2) / dt)
                }
                _ => (0.0, 0.0),
            };
            let scale = win.scale_factor().unwrap_or(1.0);
            let max = MAX_THROW * scale;
            let speed = (v.0 * v.0 + v.1 * v.1).sqrt();
            let k = if speed > max { max / speed } else { 1.0 };
            *state.throw.lock().unwrap() = Some((v.0 * k, v.1 * k));
        }
    }
    state.carrying.store(false, Ordering::Relaxed);
    let _ = app.emit_to(LABEL, "pet-carry", false);
    CarryResult { moved, home }
}

// ---------------------------------------------------------------------------
// Otak gerak: gravitasi, lemparan, jalan, manjat, nangkring
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Surface {
    Floor,
    /// Nangkring di jendela: handle + jarak tengah badan dari pinggir kiri jendela.
    Win(isize, f64),
}

#[derive(Clone, Copy, PartialEq)]
enum Gait {
    Walk,
    Run,
}

#[derive(Clone, Copy)]
enum Mode {
    /// Lagi dipegang, terbang ke notch, atau mampir notch: fisika istirahat.
    Paused,
    Air {
        vx: f64,
        vy: f64,
    },
    Ground {
        on: Surface,
    },
    Walk {
        on: Surface,
        dir: f64,
        left: f64,
        gait: Gait,
    },
    Climb {
        side: f64,
        until_y: f64,
    },
    Cling {
        side: f64,
        until: Instant,
    },
    /// Ngeringkuk siap nerkam kursor.
    Crouch {
        until: Instant,
        tx: f64,
        ty: f64,
    },
}

struct Brain {
    mode: Mode,
    /// Posisi jendela (px fisik), disimpen pecahan biar gerak pelan tetap mulus.
    x: f64,
    y: f64,
    hops_left: u32,
    hop_dir: f64,
    next_hop: Option<Instant>,
    wins: Vec<WinBox>,
    wins_at: Instant,
    perch: bool,
    cfg_at: Instant,
    settled_at: Option<Instant>,
    saved: (i32, i32),
    play: Play,
    screens: Screens,
    scale: f64,
    scale_at: Instant,
    pos_at: Instant,
}

/// Ingatan soal kursor buat main-mainan.
struct Play {
    hist: std::collections::VecDeque<(Instant, f64, f64)>,
    still_at: (f64, f64),
    still_since: Instant,
    approached: bool,
    last_dodge: Instant,
    last_pounce: Instant,
    last_touch: Instant,
    /// Lagi nerkam: Some(kena?).
    pounce: Option<bool>,
    chasing: bool,
    chase_dir: f64,
    retarget: Instant,
}

impl Play {
    fn new() -> Self {
        let past = crate::ago(Duration::from_secs(30));
        Self {
            hist: Default::default(),
            still_at: (f64::NAN, f64::NAN),
            still_since: Instant::now(),
            approached: true,
            last_dodge: past,
            last_pounce: past,
            last_touch: past,
            pounce: None,
            chasing: false,
            chase_dir: 0.0,
            retarget: past,
        }
    }

    fn sample(&mut self, now: Instant, c: (f64, f64), scale: f64) {
        self.hist.push_back((now, c.0, c.1));
        while self.hist.front().is_some_and(|(t, _, _)| now.duration_since(*t) > Duration::from_millis(1500)) {
            self.hist.pop_front();
        }
        if self.still_at.0.is_nan() || (c.0 - self.still_at.0).hypot(c.1 - self.still_at.1) > 10.0 * scale {
            self.still_at = c;
            self.still_since = now;
            self.approached = false;
        }
    }

    /// Kecepatan kursor paling kenceng (px/detik) di 150 ms terakhir.
    fn velocity(&self, now: Instant) -> (f64, f64) {
        let recent: Vec<_> = self.hist.iter().filter(|(t, _, _)| now.duration_since(*t) <= Duration::from_millis(150)).collect();
        let mut best = (0.0, 0.0);
        for w in recent.windows(2) {
            let dt = w[1].0.duration_since(w[0].0).as_secs_f64().max(0.012);
            let v = ((w[1].1 - w[0].1) / dt, (w[1].2 - w[0].2) / dt);
            if v.0.hypot(v.1) > f64::hypot(best.0, best.1) {
                best = v;
            }
        }
        best
    }

    /// Berapa kali kursor bolak-balik (kiri-kanan atau atas-bawah) dalam 1,1 detik terakhir.
    fn wiggles(&self, now: Instant, scale: f64) -> usize {
        let pts: Vec<_> = self.hist.iter().filter(|(t, _, _)| now.duration_since(*t) < Duration::from_millis(1100)).collect();
        let mut count = 0;
        for axis in 0..2 {
            let mut last_dir = 0.0;
            let mut acc = 0.0;
            for w in pts.windows(2) {
                let d = if axis == 0 { w[1].1 - w[0].1 } else { w[1].2 - w[0].2 };
                acc += d;
                if acc.abs() < 12.0 * scale {
                    continue;
                }
                let dir = acc.signum();
                if last_dir != 0.0 && dir != last_dir {
                    count += 1;
                }
                last_dir = dir;
                acc = 0.0;
            }
        }
        count
    }
}

/// Kecepatan buat loncat dari titik (x0, y0) ke (x1, y1) kena gravitasi.
fn ballistic(x0: f64, y0: f64, x1: f64, y1: f64, scale: f64) -> (f64, f64) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let t = (0.32 + dx.abs() / (2000.0 * scale) + (-dy).max(0.0) / (2600.0 * scale)).clamp(0.32, 0.75);
    let vx = dx / t;
    let vy = ((dy - 0.5 * GRAVITY * scale * t * t) / t).clamp(-2300.0 * scale, 600.0 * scale);
    (vx, vy)
}

impl Brain {
    fn place(&mut self, app: &AppHandle, win: &WebviewWindow) {
        move_to(app, win, self.x.round() as i32, self.y.round() as i32);
    }
}

fn start_brain(app: AppHandle) {
    if app.state::<PetState>().thinking.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(move || {
        let mut b = Brain {
            mode: Mode::Paused,
            x: 0.0,
            y: 0.0,
            hops_left: 0,
            hop_dir: 0.0,
            next_hop: None,
            wins: Vec::new(),
            wins_at: crate::ago(Duration::from_secs(5)),
            perch: true,
            cfg_at: crate::ago(Duration::from_secs(5)),
            settled_at: None,
            saved: (i32::MIN, i32::MIN),
            play: Play::new(),
            screens: Screens::new(),
            scale: 1.0,
            scale_at: crate::ago(Duration::from_secs(10)),
            pos_at: crate::ago(Duration::from_secs(10)),
        };
        let mut last = Instant::now();
        loop {
            let Some(win) = window(&app) else { break };
            let state = app.state::<PetState>();
            let now = Instant::now();
            let dt = now.duration_since(last).as_secs_f64().min(0.05);
            last = now;

            if b.cfg_at.elapsed() > Duration::from_secs(1) {
                b.cfg_at = now;
                b.perch = crate::settings::current(&app).pet_perch;
            }

            let busy = state.carrying.load(Ordering::Relaxed)
                || state.moving.load(Ordering::Relaxed)
                || state.away_from.lock().unwrap().is_some()
                || state.hidden.load(Ordering::Relaxed);
            if busy {
                b.mode = Mode::Paused;
                b.hops_left = 0;
                thread::sleep(Duration::from_millis(40));
                continue;
            }
            // Nanya ke jendela itu mahal (lewat thread utama), jadi skala dan
            // posisi jendela cuma dicek sesekali; sisanya pakai catatan sendiri.
            if b.scale_at.elapsed() > Duration::from_secs(1) {
                b.scale_at = now;
                b.scale = win.scale_factor().unwrap_or(b.scale);
            }
            let scale = b.scale;
            b.screens.refresh(&app);
            let body = body_metrics(&app, scale);
            let check_pos = matches!(b.mode, Mode::Paused) || b.pos_at.elapsed() > Duration::from_millis(400);
            let pos = if check_pos {
                b.pos_at = now;
                match win.outer_position() {
                    Ok(p) => p,
                    Err(_) => {
                        thread::sleep(POLL);
                        continue;
                    }
                }
            } else {
                PhysicalPosition::new(b.x.round() as i32, b.y.round() as i32)
            };

            // Baru lepas dari pegangan / balik dari notch: jatuh dari sini.
            if let Mode::Paused = b.mode {
                b.x = pos.x as f64;
                b.y = pos.y as f64;
                let (vx, vy) = state.throw.lock().unwrap().take().unwrap_or((0.0, 0.0));
                let speed = (vx * vx + vy * vy).sqrt() / scale;
                if speed > 900.0 {
                    emit_motion(&app, "thrown", vx, speed / 1000.0);
                }
                b.mode = Mode::Air { vx, vy };
                b.settled_at = None;
            } else if (pos.x - b.x.round() as i32).abs() > 2 || (pos.y - b.y.round() as i32).abs() > 2 {
                // Ada yang mindahin jendelanya (misalnya Windows pas ganti layar).
                b.x = pos.x as f64;
                b.y = pos.y as f64;
                b.mode = Mode::Air { vx: 0.0, vy: 0.0 };
            }

            let cx = b.x + body.cx;
            let feet = b.y + body.feet;
            let Some((al, at, ar, ab)) = b.screens.area(cx, feet - 2.0) else {
                thread::sleep(POLL);
                continue;
            };

            // Perintah dari frontend cuma dijalanin pas lagi napak.
            let order = state.order.lock().unwrap().take();

            // Main sama kursor: nyamperin, nerkam, menghindar, kejar-kejaran.
            if let Some(c) = cursor(&app).filter(|_| !state.fullscreen.load(Ordering::Relaxed)) {
                b.play.sample(now, c, scale);
                cursor_play(&app, &mut b, &state, now, c, body, scale, (al, at, ar, ab));
            }

            let mut fast = false;
            match b.mode {
                Mode::Paused => {}
                Mode::Air { mut vx, mut vy } => {
                    fast = true;
                    if b.perch && b.wins_at.elapsed() > Duration::from_millis(120) {
                        b.wins = wins::list();
                        b.wins_at = now;
                    }
                    vy += GRAVITY * scale * dt;
                    vx *= 1.0 - 0.15 * dt;
                    let nx = b.x + vx * dt;
                    let ny = b.y + vy * dt;
                    let ncx = nx + body.cx;
                    let nfeet = ny + body.feet;
                    b.x = nx;
                    b.y = ny;
                    if b.play.pounce == Some(false)
                        && let Some((cx_, cy_)) = cursor(&app)
                    {
                        let bcy = ny + (body.top + body.feet) / 2.0;
                        if (cx_ - ncx).hypot(cy_ - bcy) < 58.0 * scale {
                            b.play.pounce = Some(true);
                        }
                    }

                    // Pinggir kiri/kanan layar: mantul, kecuali ada layar lain di sebelahnya.
                    if ncx - body.half < al && vx < 0.0 && !b.screens.has(al - 4.0, feet - 4.0) {
                        b.x = al + body.half - body.cx;
                        if vx.abs() > 300.0 * scale {
                            emit_motion(&app, "bonk", -1.0, vx.abs() / scale / 1000.0);
                        }
                        vx = -vx * 0.5;
                    } else if ncx + body.half > ar && vx > 0.0 && !b.screens.has(ar + 4.0, feet - 4.0) {
                        b.x = ar - body.half - body.cx;
                        if vx.abs() > 300.0 * scale {
                            emit_motion(&app, "bonk", 1.0, vx.abs() / scale / 1000.0);
                        }
                        vx = -vx * 0.5;
                    }
                    // Langit-langit.
                    if b.y + body.top < at && vy < 0.0 && !b.screens.has(cx, at - 4.0) {
                        b.y = at - body.top;
                        vy = -vy * 0.3;
                    }

                    // Nangkring di jendela yang kelewatan kaki pas jatuh.
                    let mut landed: Option<(Surface, f64)> = None;
                    if vy > 0.0
                        && b.perch
                        && let Some(w) = perch_target(&b.wins, ncx, feet, nfeet, 18.0 * scale, at)
                    {
                        landed = Some((Surface::Win(w.hwnd, ncx - w.l), w.t));
                    }
                    if landed.is_none() && vy > 0.0 && nfeet >= ab {
                        landed = Some((Surface::Floor, ab));
                    }

                    if let Some((on, top)) = landed {
                        let impact = vy / scale;
                        b.y = top - body.feet;
                        if impact > 750.0 && b.hops_left == 0 {
                            // Mantul dikit sebelum diem.
                            emit_motion(&app, "bounce", vx, impact / 1000.0);
                            vy = -vy * 0.3;
                            vx *= 0.7;
                            b.mode = Mode::Air { vx, vy };
                        } else {
                            emit_motion(&app, if matches!(on, Surface::Win(..)) { "perch" } else { "land" }, vx, impact / 1000.0);
                            if let Some(hit) = b.play.pounce.take() {
                                emit_motion(&app, if hit { "pounce-hit" } else { "pounce-miss" }, vx, 0.0);
                            }
                            b.mode = Mode::Ground { on };
                            b.settled_at = Some(now);
                            if b.hops_left > 0 {
                                b.next_hop = Some(now + Duration::from_millis(110));
                            }
                        }
                    } else {
                        b.mode = Mode::Air { vx, vy };
                    }
                    b.place(&app, &win);
                }
                Mode::Ground { on } => {
                    // Masih ada pijakannya?
                    match on {
                        Surface::Floor => {
                            if (feet - ab).abs() > 3.0 {
                                if feet < ab {
                                    b.mode = Mode::Air { vx: 0.0, vy: 0.0 };
                                } else {
                                    b.y = ab - body.feet;
                                    b.place(&app, &win);
                                }
                            }
                        }
                        Surface::Win(h, off) => match wins::boxed(h) {
                            Some(w) if !w.max => {
                                let tx = w.l + off - body.cx;
                                let ty = w.t - body.feet;
                                if (tx - b.x).abs() > 0.5 || (ty - b.y).abs() > 0.5 {
                                    b.x = tx;
                                    b.y = ty;
                                    b.place(&app, &win);
                                    b.settled_at = Some(now);
                                }
                                fast = true;
                            }
                            _ => {
                                emit_motion(&app, "fall", 0.0, 1.0);
                                b.mode = Mode::Air { vx: 0.0, vy: -260.0 * scale };
                            }
                        },
                    }
                    if let Mode::Ground { on } = b.mode {
                        // Lanjutan loncat-loncat.
                        if b.hops_left > 0 && b.next_hop.is_some_and(|t| now >= t) {
                            b.hops_left -= 1;
                            b.next_hop = None;
                            emit_motion(&app, "jump", b.hop_dir, 0.7);
                            b.mode = Mode::Air { vx: b.hop_dir * 190.0 * scale, vy: -620.0 * scale };
                        } else if let Some(kind) = order.as_deref() {
                            start_order(&app, &mut b, kind, on, cx, scale, (al, ar), body);
                        }
                    }
                    // Simpen posisi kalau udah diem sebentar.
                    if let Some(t) = b.settled_at
                        && now.duration_since(t) > Duration::from_millis(1200)
                        && matches!(b.mode, Mode::Ground { on: Surface::Floor })
                    {
                        let p = (b.x.round() as i32, b.y.round() as i32);
                        if p != b.saved {
                            b.saved = p;
                            save_position(&app, &win);
                        }
                        b.settled_at = None;
                    }
                }
                Mode::Walk { on, dir, mut left, gait } => {
                    fast = true;
                    let speed = if gait == Gait::Run { RUN_SPEED } else { WALK_SPEED } * scale;
                    let step = speed * dt;
                    let (min_x, max_x, top) = match on {
                        Surface::Floor => (al + body.half, ar - body.half, Some(ab)),
                        Surface::Win(h, _) => match wins::boxed(h) {
                            Some(w) if !w.max => (w.l + 10.0 * scale, w.r - 10.0 * scale, Some(w.t)),
                            _ => (al, ar, None),
                        },
                    };
                    let Some(top) = top else {
                        emit_motion(&app, "fall", 0.0, 1.0);
                        b.mode = Mode::Air { vx: dir * speed, vy: 0.0 };
                        thread::sleep(Duration::from_millis(16));
                        continue;
                    };
                    let ncx = cx + dir * step;
                    left -= step;
                    if ncx < min_x || ncx > max_x {
                        match on {
                            Surface::Win(..) if rand_unit() < 0.45 => {
                                // Loncat dari pinggir jendela.
                                emit_motion(&app, "jump", dir, 0.8);
                                b.mode = Mode::Air { vx: dir * 260.0 * scale, vy: -420.0 * scale };
                            }
                            Surface::Floor if gait == Gait::Run && !b.screens.has(ncx + dir * 30.0 * scale, feet - 4.0) => {
                                // Lari mentok pinggir layar: manjat.
                                let up = (ab - at) * (0.35 + rand_unit() * 0.35);
                                b.x = if dir < 0.0 { al + body.half - body.cx } else { ar - body.half - body.cx };
                                emit_motion(&app, "climb", dir, 0.0);
                                b.mode = Mode::Climb { side: dir, until_y: ab - up };
                            }
                            _ => {
                                emit_motion(&app, "idle", dir, 0.0);
                                b.mode = Mode::Ground { on };
                                b.settled_at = Some(now);
                            }
                        }
                    } else {
                        b.x += dir * step;
                        b.y = top - body.feet;
                        let on = match on {
                            Surface::Win(h, off) => Surface::Win(h, off + dir * step),
                            s => s,
                        };
                        if left <= 0.0 {
                            emit_motion(&app, "idle", dir, 0.0);
                            b.mode = Mode::Ground { on };
                            b.settled_at = Some(now);
                        } else {
                            b.mode = Mode::Walk { on, dir, left, gait };
                        }
                    }
                    b.place(&app, &win);
                }
                Mode::Climb { side, until_y } => {
                    fast = true;
                    b.y -= CLIMB_SPEED * scale * dt;
                    if b.y + body.feet <= until_y {
                        emit_motion(&app, "cling", side, 0.0);
                        b.mode = Mode::Cling { side, until: now + Duration::from_millis(3500 + (rand_unit() * 5000.0) as u64) };
                    }
                    b.place(&app, &win);
                }
                Mode::Crouch { until, tx, ty } => {
                    if now >= until {
                        // Nerkam ke posisi kursor sekarang (kalau masih deket), atau ke tempat tadi.
                        let (mut gx, mut gy) = (tx, ty);
                        if let Some((cx_, cy_)) = cursor(&app)
                            && (cx_ - cx).hypot(cy_ - feet) < 420.0 * scale
                        {
                            gx = cx_;
                            gy = cy_;
                        }
                        let bcy = b.y + (body.top + body.feet) / 2.0;
                        let (vx, vy) = ballistic(cx, bcy, gx, gy, scale);
                        b.play.pounce = Some(false);
                        b.play.last_pounce = now;
                        emit_motion(&app, "pounce", vx, 1.0);
                        b.mode = Mode::Air { vx, vy };
                    }
                }
                Mode::Cling { side, until } => {
                    if now >= until || order.is_some() {
                        emit_motion(&app, "jump", -side, 0.9);
                        b.mode = Mode::Air { vx: -side * 230.0 * scale, vy: -300.0 * scale };
                    }
                }
            }
            // Kursor lagi deket: cek lebih sering biar reaksinya sigap.
            let near = state.play_ok.load(Ordering::Relaxed)
                && b.play.hist.back().is_some_and(|&(_, x, y)| (x - (b.x + body.cx)).hypot(y - (b.y + body.feet)) < 500.0 * scale);
            thread::sleep(if fast || near { Duration::from_millis(16) } else { Duration::from_millis(60) });
        }
        app.state::<PetState>().thinking.store(false, Ordering::Relaxed);
    });
}

/// Main-main sama kursor. Cuma ngubah mode kalau Pip lagi napak (diem atau jalan).
#[allow(clippy::too_many_arguments)]
fn cursor_play(
    app: &AppHandle,
    b: &mut Brain,
    state: &PetState,
    now: Instant,
    c: (f64, f64),
    body: Body,
    scale: f64,
    (al, at, ar, ab): (f64, f64, f64, f64),
) {
    let grounded = matches!(b.mode, Mode::Ground { .. } | Mode::Walk { .. });
    let on = match b.mode {
        Mode::Ground { on } | Mode::Walk { on, .. } => Some(on),
        _ => None,
    };
    let cx = b.x + body.cx;
    let top = b.y + body.top;
    let feet = b.y + body.feet;
    let bcy = (top + feet) / 2.0;
    let dx = c.0 - cx;
    let dy = c.1 - bcy;

    // ---- Kejar-kejaran ----
    let chase = state.chase_until.lock().unwrap().is_some_and(|t| now < t);
    if chase {
        if !b.play.chasing {
            b.play.chasing = true;
            b.play.chase_dir = 0.0;
        }
        // Kesentuh: kursor masuk badan Pip.
        if c.0 > cx - body.half
            && c.0 < cx + body.half
            && c.1 > top
            && c.1 < feet
            && now.duration_since(b.play.last_touch) > Duration::from_millis(900)
        {
            b.play.last_touch = now;
            emit_motion(app, "touch", dx, 1.0);
        }
        let Some(on) = on else { return };
        if dy < -90.0 * scale && dx.abs() < 240.0 * scale && now.duration_since(b.play.last_pounce) > Duration::from_millis(900) {
            let (vx, vy) = ballistic(cx, bcy, c.0, c.1, scale);
            b.play.pounce = Some(false);
            b.play.last_pounce = now;
            b.play.chase_dir = 0.0;
            emit_motion(app, "pounce", vx, 0.6);
            b.mode = Mode::Air { vx, vy };
        } else if dx.abs() > 28.0 * scale {
            let dir = dx.signum();
            if dir != b.play.chase_dir || now.duration_since(b.play.retarget) > Duration::from_millis(250) {
                b.play.retarget = now;
                if dir != b.play.chase_dir {
                    emit_motion(app, "run", dir, 0.0);
                }
                b.play.chase_dir = dir;
                b.mode = Mode::Walk { on, dir, left: dx.abs() - 12.0 * scale, gait: Gait::Run };
            }
        } else if matches!(b.mode, Mode::Walk { .. }) {
            b.play.chase_dir = 0.0;
            emit_motion(app, "idle", dx, 0.0);
            b.mode = Mode::Ground { on };
        }
        return;
    }
    if b.play.chasing {
        b.play.chasing = false;
        *state.chase_until.lock().unwrap() = None;
        emit_motion(app, "chase-end", 0.0, 0.0);
    }

    if !grounded || !state.play_ok.load(Ordering::Relaxed) {
        return;
    }
    let Some(on) = on else { return };
    let dist = dx.hypot(dy);

    // ---- Menghindar: kursor dilempar cepet ke arah Pip ----
    let (vx, vy) = b.play.velocity(now);
    let speed = vx.hypot(vy);
    let toward = if dist > 0.0 { (vx * -dx + vy * -dy) / dist } else { 0.0 };
    if dist < 240.0 * scale
        && speed > 1900.0 * scale
        && toward > 0.7 * speed
        && now.duration_since(b.play.last_dodge) > Duration::from_secs(3)
    {
        b.play.last_dodge = now;
        let away = if dx > 0.0 { -1.0 } else { 1.0 };
        emit_motion(app, "dodge", away, 1.0);
        b.mode = Mode::Air { vx: away * 330.0 * scale, vy: -640.0 * scale };
        return;
    }

    // ---- Nerkam: kursor digoyang-goyang di deket Pip ----
    if matches!(b.mode, Mode::Ground { .. })
        && dist < 320.0 * scale
        && c.1 < feet + 10.0 * scale
        && now.duration_since(b.play.last_pounce) > Duration::from_secs(5)
        && b.play.wiggles(now, scale) >= 4
    {
        b.play.last_pounce = now;
        emit_motion(app, "crouch", dx, 0.0);
        b.mode = Mode::Crouch { until: now + Duration::from_millis(520), tx: c.0, ty: c.1 };
        return;
    }

    // ---- Nyamperin: kursor diem lama di deket Pip ----
    let still = now.duration_since(b.play.still_since) > Duration::from_secs(4);
    if matches!(b.mode, Mode::Ground { .. })
        && still
        && !b.play.approached
        && dx.abs() > 55.0 * scale
        && dx.abs() < 460.0 * scale
        && c.1 < feet + 20.0 * scale
        && c.1 > at
        && (feet - c.1) < 520.0 * scale
        && c.0 > al
        && c.0 < ar
        && feet <= ab + 2.0
    {
        b.play.approached = true;
        let dir = dx.signum();
        emit_motion(app, "approach", dir, 0.0);
        b.mode = Mode::Walk { on, dir, left: dx.abs() - 34.0 * scale, gait: Gait::Walk };
    }
}

/// Mulai gerakan yang diminta frontend.
#[allow(clippy::too_many_arguments)]
fn start_order(app: &AppHandle, b: &mut Brain, kind: &str, on: Surface, cx: f64, scale: f64, (al, ar): (f64, f64), body: Body) {
    // Arah: lebih sering ke tengah layar biar nggak nempel di pojok terus.
    let mid = (al + ar) / 2.0;
    let toward_mid = if cx < mid { 1.0 } else { -1.0 };
    let dir = if rand_unit() < 0.65 { toward_mid } else { -toward_mid };
    let _ = body;
    match kind {
        "walk" | "run" => {
            let gait = if kind == "run" { Gait::Run } else { Gait::Walk };
            let dist = if gait == Gait::Run { 220.0 + rand_unit() * 420.0 } else { 80.0 + rand_unit() * 240.0 } * scale;
            emit_motion(app, if gait == Gait::Run { "run" } else { "walk" }, dir, 0.0);
            b.mode = Mode::Walk { on, dir, left: dist, gait };
        }
        "climb" => {
            // Lari ke pinggir layar terdekat, nanti manjat sendiri pas mentok.
            let side = if cx < mid { -1.0 } else { 1.0 };
            emit_motion(app, "run", side, 0.0);
            b.mode = Mode::Walk { on: Surface::Floor, dir: side, left: f64::MAX, gait: Gait::Run };
            if !matches!(on, Surface::Floor) {
                b.mode = Mode::Walk { on, dir: side, left: 300.0 * scale, gait: Gait::Run };
            }
        }
        "hop" => {
            b.hops_left = 2 + (rand_unit() * 3.0) as u32;
            b.hop_dir = dir;
            b.next_hop = Some(Instant::now());
        }
        "jump" => {
            emit_motion(app, "jump", 0.0, 1.0);
            b.mode = Mode::Air { vx: 0.0, vy: -760.0 * scale };
        }
        "jumpdown" => {
            if matches!(on, Surface::Win(..)) {
                emit_motion(app, "jump", dir, 0.8);
                b.mode = Mode::Air { vx: dir * 240.0 * scale, vy: -380.0 * scale };
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Lagi ngetik? (buat Pip ikut buka laptop)
// ---------------------------------------------------------------------------

/// Nebak lu lagi ngetik: tiap 30 ms dicek ada tombol ketik (huruf, angka,
/// spasi, enter, tanda baca) yang baru dipencet atau nggak. Yang dihitung
/// cuma *jumlah* pencetan; tombol apa yang dipencet nggak pernah disimpen,
/// jadi isi ketikan nggak bisa disusun ulang. Scroll dan klik mouse nggak
/// keitung, Ctrl/Alt/Shift sendirian juga nggak.
struct TypingGuess {
    was_down: bool,
    hits: Vec<Instant>,
    typing: bool,
}

impl TypingGuess {
    fn new() -> Self {
        Self { was_down: false, hits: Vec::new(), typing: false }
    }

    /// Balikin Some(baru) kalau statusnya berubah.
    fn update(&mut self) -> Option<bool> {
        let now = Instant::now();
        let (down, pressed) = typing_keys();
        // Pencetan baru: ada tombol yang baru turun, atau kepencet di antara dua cek.
        if pressed || (down && !self.was_down) {
            self.hits.push(now);
        }
        self.was_down = down;
        self.hits.retain(|t| now.duration_since(*t) < Duration::from_millis(2500));
        let typing = if self.typing { !self.hits.is_empty() } else { self.hits.len() >= 3 };
        if typing != self.typing {
            self.typing = typing;
            return Some(typing);
        }
        None
    }
}

/// Mouse ditekan di Explorer atau desktop? Kalau iya dan kursornya kegeser,
/// kemungkinan besar lu lagi nyeret file/folder (Pip mangap nunggu makanan).
#[cfg(windows)]
fn press_on_files(x: f64, y: f64) -> bool {
    use windows::Win32::{
        Foundation::POINT,
        UI::WindowsAndMessaging::{GA_ROOT, GetAncestor, GetClassNameW, WindowFromPoint},
    };
    unsafe {
        let h = WindowFromPoint(POINT { x: x as i32, y: y as i32 });
        if h.is_invalid() {
            return false;
        }
        let root = GetAncestor(h, GA_ROOT);
        let mut buf = [0u16; 64];
        let n = GetClassNameW(root, &mut buf) as usize;
        let class = String::from_utf16_lossy(&buf[..n.min(64)]);
        matches!(class.as_str(), "CabinetWClass" | "ExploreWClass" | "Progman" | "WorkerW")
    }
}

#[cfg(not(windows))]
fn press_on_files(_x: f64, _y: f64) -> bool {
    false
}

/// (ada tombol ketik yang lagi ditahan, ada yang kepencet sejak cek terakhir).
#[cfg(windows)]
fn typing_keys() -> (bool, bool) {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    const RANGES: [(i32, i32); 9] = [
        (0x08, 0x08), // Backspace
        (0x0D, 0x0D), // Enter
        (0x20, 0x20), // Spasi
        (0x30, 0x39), // 0-9
        (0x41, 0x5A), // A-Z
        (0x60, 0x6F), // Numpad
        (0xBA, 0xC0), // Tanda baca
        (0xDB, 0xDE), // Kurung, garis miring, kutip
        (0xE2, 0xE2), // Tanda baca tambahan (keyboard non-US)
    ];
    let (mut down, mut pressed) = (false, false);
    for (a, b) in RANGES {
        for vk in a..=b {
            let st = unsafe { GetAsyncKeyState(vk) } as u16;
            down |= st & 0x8000 != 0;
            pressed |= st & 0x0001 != 0;
        }
    }
    (down, pressed)
}

#[cfg(not(windows))]
fn typing_keys() -> (bool, bool) {
    (false, false)
}

// ---------------------------------------------------------------------------
// Pantauan: kursor, tembus klik, app fullscreen
// ---------------------------------------------------------------------------

fn inside(r: &Rect, x: f64, y: f64, pad: f64) -> bool {
    r.w > 0.0 && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
}

fn start_watcher(app: AppHandle) {
    if app.state::<PetState>().watching.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(move || {
        let mut over = false;
        let mut typing = TypingGuess::new();
        let mut was_down = false;
        let mut pressed_outside = false;
        let mut press_at: Option<(f64, f64)> = None;
        let mut scale = 1.0_f64;
        let mut scale_at = crate::ago(Duration::from_secs(5));
        let mut file_near = false;
        let mut hidden = false;
        let mut last_slow = crate::ago(Duration::from_secs(10));
        let mut last_cursor = (f64::NAN, f64::NAN);
        let mut last_sent = Instant::now();
        loop {
            let Some(win) = window(&app) else { break };
            let state = app.state::<PetState>();

            if last_slow.elapsed() > Duration::from_millis(600) {
                last_slow = Instant::now();
                let settings = crate::settings::current(&app);
                let own = crate::island::window_handle(&win);
                let fullscreen = settings.hide_in_fullscreen && crate::island::foreground_is_fullscreen(own);
                let hide = crate::island::is_paused(&app) || (fullscreen && !settings.pet_over_fullscreen);
                if hide != hidden {
                    hidden = hide;
                    state.hidden.store(hide, Ordering::Relaxed);
                    let _ = if hide { win.hide() } else { win.show() };
                }
                // Nemenin app fullscreen: jangan sampai klik di game/film ketangkep Pip.
                let watching_fs = fullscreen && !hide;
                if watching_fs != state.fullscreen.swap(watching_fs, Ordering::Relaxed) && watching_fs && over {
                    over = false;
                    let _ = win.set_ignore_cursor_events(true);
                    let _ = app.emit_to(LABEL, "pet-hover", false);
                }
                if watching_fs {
                    crate::island::keep_on_top(own);
                }
            }
            if hidden {
                crate::drop_catcher::place_pet(None);
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            // Posisi jendela dari catatan sendiri (Pip cuma dipindahin PoinTify),
            // skala dicek sesekali: nanya ke jendela tiap 30 ms itu mahal.
            if scale_at.elapsed() > Duration::from_millis(800) {
                scale_at = Instant::now();
                scale = win.scale_factor().unwrap_or(scale);
                if let Ok(p) = win.outer_position() {
                    *state.pos.lock().unwrap() = Some((p.x, p.y));
                }
            }
            let pos = *state.pos.lock().unwrap();
            let (Some(c), Some(pos)) = (cursor(&app), pos) else {
                thread::sleep(POLL);
                continue;
            };
            let cursor = PhysicalPosition::new(c.0, c.1);
            let pos = PhysicalPosition::new(pos.0, pos.1);
            let rel = ((cursor.x - pos.x as f64) / scale, (cursor.y - pos.y as f64) / scale);

            if let Some(now_typing) = typing.update() {
                let _ = app.emit_to(LABEL, "pet-typing", now_typing);
            }

            // Mata Pip ngikutin kursor.
            if last_sent.elapsed() >= CURSOR_EVERY
                && ((rel.0 - last_cursor.0).abs() >= 2.0 || (rel.1 - last_cursor.1).abs() >= 2.0 || last_cursor.0.is_nan())
            {
                last_cursor = rel;
                last_sent = Instant::now();
                // Namanya beda sama punya notch, biar mata Pip nggak kebingungan dua sumber.
                let _ = app.emit_to(LABEL, "pet-cursor", CursorPos { x: rel.0, y: rel.1 });
            }

            // Tembus klik di luar badan Pip dan papannya (dan di mana-mana pas
            // lagi ada app fullscreen).
            let body = *state.hit.lock().unwrap();
            let interactive = !state.fullscreen.load(Ordering::Relaxed);
            let now_inside = state.carrying.load(Ordering::Relaxed)
                || (interactive
                    && (inside(&body, rel.0, rel.1, 4.0) || state.extra.lock().unwrap().iter().any(|r| inside(r, rel.0, rel.1, 2.0))));
            if now_inside != over {
                over = now_inside;
                let _ = win.set_ignore_cursor_events(!over);
                let _ = app.emit_to(LABEL, "pet-hover", over && inside(&body, rel.0, rel.1, 4.0));
            }

            // File diseret dari luar (Explorer, desktop) ke atas Pip: pasang
            // penangkap file native di atas badannya, biar bisa "dimakan".
            let down = crate::drop_catcher::left_button_down();
            if down && !was_down {
                pressed_outside = !inside(&body, rel.0, rel.1, 4.0);
                press_at = (pressed_outside && press_on_files(cursor.x, cursor.y)).then_some((cursor.x, cursor.y));
            }
            if !down {
                pressed_outside = false;
                press_at = None;
            }
            was_down = down;
            // Lagi nyeret sesuatu dari Explorer/desktop: Pip mangap.
            let dragging_files = press_at.is_some_and(|(px, py)| (cursor.x - px).hypot(cursor.y - py) > 24.0 * scale);
            if dragging_files != file_near {
                file_near = dragging_files;
                let _ = app.emit_to(LABEL, "pet-file-near", file_near);
            }
            let catch =
                (interactive && down && pressed_outside && !state.carrying.load(Ordering::Relaxed) && inside(&body, rel.0, rel.1, 18.0))
                    .then(|| {
                        let pad = 18.0;
                        (
                            (pos.x as f64 + (body.x - pad) * scale) as i32,
                            (pos.y as f64 + (body.y - pad) * scale) as i32,
                            ((body.w + pad * 2.0) * scale) as i32,
                            ((body.h + pad * 2.0) * scale) as i32,
                        )
                    });
            crate::drop_catcher::place_pet(catch);
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
    let cursor = cursor(&app)
        .map(|(x, y)| PhysicalPosition::new(x, y))
        .ok_or(crate::i18n::tr("Posisi kursor nggak kebaca", "Couldn't read the cursor position"))?;
    let scale = app.monitor_from_point(cursor.x, cursor.y).ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let body = body_metrics(&app, scale);
    let grab = (body.cx, body.top + (body.feet - body.top) * 0.45);
    let at = ((cursor.x - grab.0) as i32, (cursor.y - grab.1) as i32);
    let win = ensure_window(&app, Some(at)).map_err(|e| e.to_string())?;
    set_mode(&app, true);
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || carry(&app2, &win, Some(grab))).await.map_err(|e| e.to_string())?;
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
    let win = window(&app).ok_or(crate::i18n::tr("Pip lagi nggak di desktop", "Pip isn't on the desktop"))?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let grab = grab_x.zip(grab_y).map(|(x, y)| (x * scale, y * scale));
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || carry(&app2, &win, grab)).await.map_err(|e| e.to_string())?;
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
pub fn pet_set_hit(state: State<PetState>, rect: Rect, extra: Option<Vec<Rect>>) {
    *state.hit.lock().unwrap() = rect;
    *state.extra.lock().unwrap() = extra.unwrap_or_default();
}

/// Minta Pip gerak: walk | run | hop | climb | jump | jumpdown.
/// Dijalanin pas Pip lagi napak; kalau lagi sibuk, perintahnya diganti yang baru.
#[tauri::command]
pub fn pet_do(state: State<PetState>, kind: String) {
    *state.order.lock().unwrap() = Some(kind);
}

/// Ada notif di notch: Pip mampir ke sebelah notch.
#[tauri::command]
pub async fn pet_visit(app: AppHandle, offset: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PetState>();
        let Some(win) = window(&app) else { return };
        // Lagi ada app fullscreen: notch-nya sembunyi, nggak ada yang perlu disamperin.
        if state.carrying.load(Ordering::Relaxed) || state.fullscreen.load(Ordering::Relaxed) {
            return;
        }
        let mut away = state.away_from.lock().unwrap();
        if away.is_none()
            && let Ok(p) = win.outer_position()
        {
            *away = Some((p.x, p.y));
        }
        drop(away);
        if let Some(spot) = notch_spot(&app, offset) {
            fly(&app, &win, spot, 650);
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Notif beres: balik ke tempat semula (abis itu fisika jalan lagi).
#[tauri::command]
pub async fn pet_return(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PetState>();
        let Some(win) = window(&app) else { return };
        let from = *state.away_from.lock().unwrap();
        if let Some(p) = from
            && !state.carrying.load(Ordering::Relaxed)
        {
            fly(&app, &win, p, 700);
        }
        *state.away_from.lock().unwrap() = None;
    })
    .await
    .map_err(|e| e.to_string())
}

/// Pip lagi santai (boleh nyamperin, nerkam, dan menghindar kursor) atau nggak.
#[tauri::command]
pub fn pet_play(state: State<PetState>, ok: bool) {
    state.play_ok.store(ok, Ordering::Relaxed);
}

/// Main kejar-kejaran selama `seconds` detik (0 = udahan).
#[tauri::command]
pub fn pet_chase(state: State<PetState>, seconds: f64) {
    *state.chase_until.lock().unwrap() = (seconds > 0.0).then(|| Instant::now() + Duration::from_secs_f64(seconds.min(120.0)));
}
