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
        atomic::{AtomicBool, Ordering},
        Mutex,
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

fn rand_unit() -> f64 {
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(Instant::now().elapsed().as_nanos());
    (h.finish() % 10_000) as f64 / 10_000.0
}

fn emit_motion(app: &AppHandle, kind: &'static str, dir: f64, power: f64) {
    let _ = app.emit_to(LABEL, "pet-motion", Motion { kind, dir: if dir == 0.0 { 0 } else { dir.signum() as i32 }, power: (power * 100.0).round() / 100.0 });
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

/// Area kerja (tanpa taskbar) layar tempat titik ini berada, px fisik: (kiri, atas, kanan, bawah).
fn area_at(app: &AppHandle, x: f64, y: f64) -> Option<(f64, f64, f64, f64)> {
    let inside = app.available_monitors().unwrap_or_default().into_iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        x >= p.x as f64 && x < p.x as f64 + s.width as f64 && y >= p.y as f64 && y < p.y as f64 + s.height as f64
    });
    let m = inside
        .or_else(|| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let a = m.work_area();
    let (l, t) = (a.position.x as f64, a.position.y as f64);
    Some((l, t, l + a.size.width as f64, t + a.size.height as f64))
}

/// Ada layar beneran di titik ini? (Dicek sendiri dari daftar monitor, karena
/// `monitor_from_point` di beberapa sistem tetap balikin layar terdekat.)
fn has_screen_at(app: &AppHandle, x: f64, y: f64) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        x >= p.x as f64 && x < p.x as f64 + s.width as f64 && y >= p.y as f64 && y < p.y as f64 + s.height as f64
    })
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
        core::BOOL,
        Win32::{
            Foundation::{HWND, LPARAM, RECT},
            Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            UI::WindowsAndMessaging::{
                EnumWindows, GetClassNameW, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed,
                GWL_EXSTYLE, GWL_STYLE, WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
            },
        },
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

    let start_cursor = app.cursor_position().ok();
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
    loop {
        let Ok(c) = app.cursor_position() else { break };
        if let Some(s) = start_cursor {
            if (c.x - s.x).abs() + (c.y - s.y).abs() > 6.0 {
                moved = true;
            }
        }
        let now = Instant::now();
        trail.push((now, c.x, c.y));
        trail.retain(|(t, _, _)| now.duration_since(*t) < Duration::from_millis(120));
        if last.map(|l| l.x != c.x || l.y != c.y).unwrap_or(true) {
            let _ = win.set_position(PhysicalPosition::new((c.x - gx).round() as i32, (c.y - gy).round() as i32));
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
    Air { vx: f64, vy: f64 },
    Ground { on: Surface },
    Walk { on: Surface, dir: f64, left: f64, gait: Gait },
    Climb { side: f64, until_y: f64 },
    Cling { side: f64, until: Instant },
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
}

impl Brain {
    fn place(&mut self, win: &WebviewWindow) {
        let _ = win.set_position(PhysicalPosition::new(self.x.round() as i32, self.y.round() as i32));
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
            wins_at: Instant::now() - Duration::from_secs(5),
            perch: true,
            cfg_at: Instant::now() - Duration::from_secs(5),
            settled_at: None,
            saved: (i32::MIN, i32::MIN),
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
                || !win.is_visible().unwrap_or(false);
            if busy {
                b.mode = Mode::Paused;
                b.hops_left = 0;
                thread::sleep(Duration::from_millis(40));
                continue;
            }
            let Ok(pos) = win.outer_position() else {
                thread::sleep(POLL);
                continue;
            };
            let scale = win.scale_factor().unwrap_or(1.0);
            let body = body_metrics(&app, scale);

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
            let Some((al, at, ar, ab)) = area_at(&app, cx, feet - 2.0) else {
                thread::sleep(POLL);
                continue;
            };

            // Perintah dari frontend cuma dijalanin pas lagi napak.
            let order = state.order.lock().unwrap().take();

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

                    // Pinggir kiri/kanan layar: mantul, kecuali ada layar lain di sebelahnya.
                    if ncx - body.half < al && vx < 0.0 && !has_screen_at(&app, al - 4.0, feet - 4.0) {
                        b.x = al + body.half - body.cx;
                        if vx.abs() > 300.0 * scale {
                            emit_motion(&app, "bonk", -1.0, vx.abs() / scale / 1000.0);
                        }
                        vx = -vx * 0.5;
                    } else if ncx + body.half > ar && vx > 0.0 && !has_screen_at(&app, ar + 4.0, feet - 4.0) {
                        b.x = ar - body.half - body.cx;
                        if vx.abs() > 300.0 * scale {
                            emit_motion(&app, "bonk", 1.0, vx.abs() / scale / 1000.0);
                        }
                        vx = -vx * 0.5;
                    }
                    // Langit-langit.
                    if b.y + body.top < at && vy < 0.0 && !has_screen_at(&app, cx, at - 4.0) {
                        b.y = at - body.top;
                        vy = -vy * 0.3;
                    }

                    // Nangkring di jendela yang kelewatan kaki pas jatuh.
                    let mut landed: Option<(Surface, f64)> = None;
                    if vy > 0.0 && b.perch {
                        if let Some(w) = perch_target(&b.wins, ncx, feet, nfeet, 18.0 * scale, at) {
                            landed = Some((Surface::Win(w.hwnd, ncx - w.l), w.t));
                        }
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
                            b.mode = Mode::Ground { on };
                            b.settled_at = Some(now);
                            if b.hops_left > 0 {
                                b.next_hop = Some(now + Duration::from_millis(110));
                            }
                        }
                    } else {
                        b.mode = Mode::Air { vx, vy };
                    }
                    b.place(&win);
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
                                    b.place(&win);
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
                                    b.place(&win);
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
                    if let Some(t) = b.settled_at {
                        if now.duration_since(t) > Duration::from_millis(1200) && matches!(b.mode, Mode::Ground { on: Surface::Floor }) {
                            let p = (b.x.round() as i32, b.y.round() as i32);
                            if p != b.saved {
                                b.saved = p;
                                save_position(&app, &win);
                            }
                            b.settled_at = None;
                        }
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
                            Surface::Floor if gait == Gait::Run && !has_screen_at(&app, ncx + dir * 30.0 * scale, feet - 4.0) => {
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
                    b.place(&win);
                }
                Mode::Climb { side, until_y } => {
                    fast = true;
                    b.y -= CLIMB_SPEED * scale * dt;
                    if b.y + body.feet <= until_y {
                        emit_motion(&app, "cling", side, 0.0);
                        b.mode = Mode::Cling { side, until: now + Duration::from_millis(3500 + (rand_unit() * 5000.0) as u64) };
                    }
                    b.place(&win);
                }
                Mode::Cling { side, until } => {
                    if now >= until || order.is_some() {
                        emit_motion(&app, "jump", -side, 0.9);
                        b.mode = Mode::Air { vx: -side * 230.0 * scale, vy: -300.0 * scale };
                    }
                }
            }
            thread::sleep(if fast { Duration::from_millis(16) } else { Duration::from_millis(60) });
        }
        app.state::<PetState>().thinking.store(false, Ordering::Relaxed);
    });
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

            // Tembus klik di luar badan Pip dan papannya.
            let body = *state.hit.lock().unwrap();
            let now_inside = state.carrying.load(Ordering::Relaxed)
                || inside(&body, rel.0, rel.1, 4.0)
                || state.extra.lock().unwrap().iter().any(|r| inside(r, rel.0, rel.1, 2.0));
            if now_inside != over {
                over = now_inside;
                let _ = win.set_ignore_cursor_events(!over);
                let _ = app.emit_to(LABEL, "pet-hover", over && inside(&body, rel.0, rel.1, 4.0));
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
    let body = body_metrics(&app, scale);
    let grab = (body.cx, body.top + (body.feet - body.top) * 0.45);
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

/// Notif beres: balik ke tempat semula (abis itu fisika jalan lagi).
#[tauri::command]
pub async fn pet_return(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PetState>();
        let Some(win) = window(&app) else { return };
        let from = *state.away_from.lock().unwrap();
        if let Some(p) = from {
            if !state.carrying.load(Ordering::Relaxed) {
                fly(&app, &win, p, 700);
            }
        }
        *state.away_from.lock().unwrap() = None;
    })
    .await
    .map_err(|e| e.to_string())
}
