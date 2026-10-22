//! Pengaturan PoinTify: disimpan sebagai JSON di folder config aplikasi,
//! dibagi ke semua jendela lewat event `settings-changed`.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    // Notch
    pub open_on_hover: bool,
    pub hover_delay_ms: u32,
    pub hide_in_fullscreen: bool,
    pub launch_at_startup: bool,
    pub shortcut: String,
    pub sounds: bool,
    // Musik
    pub show_lyrics: bool,
    /// Baris lirik jalan di tengah notch kecil pas lagu diputer.
    pub compact_lyrics: bool,
    pub lyric_offset_ms: i32,
    // Fokus
    pub focus_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_before_long_break: u32,
    pub auto_start_breaks: bool,
    // Minum
    pub water_enabled: bool,
    pub water_interval_minutes: u32,
    pub water_goal: u32,
    pub water_start_hour: u32,
    pub water_end_hour: u32,
    // Claude
    pub claude_path: String,
    pub claude_model: String,
    pub claude_effort: String,
    pub claude_mode: String,
    pub projects: Vec<Project>,
    pub active_project: Option<String>,
    // Pip di desktop
    pub pet_mode: bool,
    pub pet_wander: bool,
    pub pet_pos: Option<[i32; 2]>,
    /// "calm" | "normal" | "hyper": seberapa sering Pip gerak sendiri.
    pub pet_activity: String,
    /// Pip ngomong lewat balon tiap sekian menit (0 = nggak pernah).
    pub pet_talk_minutes: u32,
    /// Boleh nangkring di pinggir atas jendela lain.
    pub pet_perch: bool,
    /// Ikut kegiatan lu: joget pas musik, ngetik pas Claude kerja, ikat kepala pas fokus.
    pub pet_follow: bool,
    /// Megang papan info Live.
    pub pet_live_sign: bool,
    /// Tidur siang kalau lama dicuekin.
    pub pet_nap: bool,
    /// Main sama kursor: nyamperin, nerkam, menghindar.
    pub pet_cursor: bool,
    // Kanvas widget di Beranda: susunan, ukuran, dan isi tiap widget.
    // Bentuknya diatur frontend, Rust cuma nyimpen.
    pub widgets: serde_json::Value,
    /// "auto" (ikut Windows), "id", atau "en".
    pub language: String,
    /// Tour perkenalan udah pernah ditonton.
    pub tour_done: bool,
    /// Cek versi baru di GitHub pas PoinTify nyala.
    pub auto_update: bool,
    /// "dark", "light", atau "auto" (ikut mode Windows).
    pub theme: String,
    /// Warna aksen: violet, blue, teal, green, amber, orange, pink, red.
    pub accent: String,
    /// Pantau folder Downloads buat progres download di notch.
    pub download_watch: bool,
    /// Shortcut global buat command palette (kosong = mati).
    pub palette_shortcut: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            open_on_hover: true,
            hover_delay_ms: 120,
            hide_in_fullscreen: true,
            launch_at_startup: false,
            shortcut: "Ctrl+Alt+P".into(),
            sounds: true,
            show_lyrics: true,
            compact_lyrics: true,
            lyric_offset_ms: 0,
            focus_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long_break: 4,
            auto_start_breaks: true,
            water_enabled: true,
            water_interval_minutes: 45,
            water_goal: 8,
            water_start_hour: 8,
            water_end_hour: 22,
            claude_path: String::new(),
            claude_model: "opus".into(),
            claude_effort: "high".into(),
            claude_mode: "chat".into(),
            projects: Vec::new(),
            active_project: None,
            pet_mode: false,
            pet_wander: true,
            pet_pos: None,
            pet_activity: "normal".into(),
            pet_talk_minutes: 3,
            pet_perch: true,
            pet_follow: true,
            pet_live_sign: true,
            pet_nap: true,
            pet_cursor: true,
            widgets: serde_json::Value::Null,
            language: "auto".into(),
            tour_done: false,
            auto_update: true,
            theme: "dark".into(),
            accent: "violet".into(),
            download_watch: true,
            palette_shortcut: "Alt+Space".into(),
        }
    }
}

#[derive(Default)]
pub struct SettingsState(pub Mutex<Settings>);

fn file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

/// Ambil salinan pengaturan saat ini (dipakai modul Rust lain).
pub fn current(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let loaded = match file_path(app).and_then(|p| fs::read_to_string(&p).ok().map(|s| (p, s))) {
        Some((path, text)) => match serde_json::from_str::<Settings>(&text) {
            Ok(s) => s,
            Err(e) => {
                // File rusak (misalnya PC mati pas lagi nyimpen): simpen salinannya,
                // jangan ditimpa diem-diem biar susunan widget lu masih bisa diselamatin.
                eprintln!("[pointify] settings.json rusak ({e}), pakai bawaan");
                let _ = fs::copy(&path, path.with_extension("json.rusak"));
                Settings::default()
            }
        },
        None => Settings::default(),
    };
    crate::i18n::set_from(&loaded.language);
    *app.state::<SettingsState>().0.lock().unwrap() = loaded;
    Ok(())
}

/// Tulis file lewat file sementara lalu ganti nama, biar nggak pernah ada
/// file setengah jadi kalau PoinTify ketutup paksa pas lagi nyimpen.
pub fn write_atomic(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

fn save(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let path = file_path(app).ok_or(crate::i18n::tr("Folder config nggak ketemu", "Config folder not found"))?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&path, &json).map_err(|e| e.to_string())
}

/// Ubah pengaturan dari Rust (misalnya posisi Pip), simpan, dan kabarin semua jendela.
pub fn update(app: &AppHandle, f: impl FnOnce(&mut Settings)) {
    let next = {
        let state = app.state::<SettingsState>();
        let mut s = state.0.lock().unwrap();
        f(&mut s);
        s.clone()
    };
    if let Err(e) = save(app, &next) {
        eprintln!("[pointify] pengaturan gagal disimpan: {e}");
    }
    let _ = app.emit("settings-changed", &next);
}

/// Daftarin shortcut global: buka chat dan command palette dari mana aja.
pub fn apply_shortcut(app: &AppHandle) {
    let s = current(app);
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let chat = s.shortcut.trim().to_string();
    if !chat.is_empty() {
        let result = gs.on_shortcut(chat.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                crate::island::toggle_chat(app);
            }
        });
        if let Err(e) = result {
            eprintln!("[pointify] shortcut '{chat}' gagal didaftarkan: {e}");
        }
    }
    let palette = s.palette_shortcut.trim().to_string();
    if !palette.is_empty() && !palette.eq_ignore_ascii_case(&chat) {
        let result = gs.on_shortcut(palette.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                crate::palette::open(app);
            }
        });
        if let Err(e) = result {
            eprintln!("[pointify] shortcut palette '{palette}' gagal didaftarkan: {e}");
        }
    }
}

fn apply_autostart(app: &AppHandle, enabled: bool) {
    let launcher = app.autolaunch();
    let is_enabled = launcher.is_enabled().unwrap_or(false);
    if enabled && !is_enabled {
        let _ = launcher.enable();
    } else if !enabled && is_enabled {
        let _ = launcher.disable();
    }
}

#[tauri::command]
pub fn settings_get(state: State<SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

/// Ubah sebagian pengaturan. Frontend cuma ngirim yang dia ubah, jadi
/// perubahan dari jendela lain atau dari Rust (posisi Pip, misalnya) yang
/// kejadian barengan nggak ketimpa salinan lama.
#[tauri::command]
pub fn settings_patch(app: AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    let serde_json::Value::Object(patch) = patch else {
        return Err(crate::i18n::tr("Format pengaturan salah", "Invalid settings format").into());
    };
    let merged = {
        let state = app.state::<SettingsState>();
        let s = state.0.lock().unwrap();
        let mut value = serde_json::to_value(&*s).map_err(|e| e.to_string())?;
        if let serde_json::Value::Object(map) = &mut value {
            for (k, v) in patch {
                map.insert(k, v);
            }
        }
        serde_json::from_value::<Settings>(value)
            .map_err(|e| format!("{}: {e}", crate::i18n::tr("Pengaturan nggak valid", "Invalid settings")))?
    };
    settings_set(app, merged)
}

#[tauri::command]
pub fn settings_set(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let previous = current(&app);
    save(&app, &settings)?;
    *app.state::<SettingsState>().0.lock().unwrap() = settings.clone();

    if previous.shortcut != settings.shortcut || previous.palette_shortcut != settings.palette_shortcut {
        apply_shortcut(&app);
    }
    if previous.launch_at_startup != settings.launch_at_startup {
        apply_autostart(&app, settings.launch_at_startup);
    }
    if previous.pet_mode != settings.pet_mode {
        crate::pet::apply_mode_later(&app, settings.pet_mode);
    }
    if crate::i18n::set_from(&settings.language) {
        crate::tray::relabel(&app);
    }
    let _ = app.emit("settings-changed", &settings);
    Ok(settings)
}

/// Command async: di Windows, bikin jendela dari command biasa (yang jalan di
/// thread utama) bikin WebView2 macet dan jendelanya cuma putih.
#[tauri::command]
pub async fn settings_open(app: AppHandle) -> Result<(), String> {
    open_window(&app).map_err(|e| e.to_string())
}

/// Buka pengaturan dari tempat yang jalan di thread utama (misalnya menu tray):
/// pindahin dulu ke thread lain dengan alasan yang sama.
pub fn open_window_later(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = open_window(&app) {
            eprintln!("[pointify] jendela pengaturan gagal dibuka: {e}");
        }
    });
}

/// Buka (atau munculin lagi) jendela pengaturan.
fn open_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("settings") {
        win.unminimize()?;
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("index.html".into()))
        .title(crate::i18n::tr("Pengaturan PoinTify", "PoinTify Settings"))
        .inner_size(820.0, 600.0)
        .min_inner_size(680.0, 500.0)
        .decorations(false)
        .center()
        .build()?;
    Ok(())
}
