//! Command palette: daftar app dari Start Menu dan file yang baru dibuka,
//! plus shortcut global buat munculin palette di notch.

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    /// Yang dibuka pas dipilih (shortcut .lnk-nya langsung).
    pub path: String,
}

/// Daftar app di-cache sebentar: Start Menu jarang berubah, tapi palette sering dibuka.
static APPS: Mutex<Option<(Instant, Vec<Entry>)>> = Mutex::new(None);

const SKIP: &[&str] = &["uninstall", "readme", "help", "documentation", "website", "release notes", "license", "manual"];

fn walk(dir: &Path, depth: usize, out: &mut Vec<Entry>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if path.is_dir() {
            if depth < 3 {
                walk(&path, depth + 1, out);
            }
            continue;
        }
        let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "lnk" | "url" | "appref-ms") {
            continue;
        }
        let Some(name) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
        let lower = name.to_lowercase();
        if SKIP.iter().any(|s| lower.contains(s)) {
            continue;
        }
        out.push(Entry { name, path: path.to_string_lossy().to_string() });
    }
}

fn start_menu_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for (var, sub) in [("ProgramData", "Microsoft\\Windows\\Start Menu\\Programs"), ("APPDATA", "Microsoft\\Windows\\Start Menu\\Programs")]
    {
        if let Some(base) = std::env::var_os(var) {
            dirs.push(PathBuf::from(base).join(sub));
        }
    }
    dirs
}

/// App yang kepasang (dari shortcut Start Menu), urut nama, tanpa dobel.
#[tauri::command]
pub async fn palette_apps() -> Vec<Entry> {
    if let Some((at, list)) = APPS.lock().unwrap().as_ref()
        && at.elapsed() < Duration::from_secs(120)
    {
        return list.clone();
    }
    let list = tauri::async_runtime::spawn_blocking(|| {
        let mut out = Vec::new();
        for d in start_menu_dirs() {
            walk(&d, 0, &mut out);
        }
        out.sort_by_key(|e| e.name.to_lowercase());
        out.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
        out
    })
    .await
    .unwrap_or_default();
    *APPS.lock().unwrap() = Some((Instant::now(), list.clone()));
    list
}

/// File yang baru lu buka (folder Recent Windows), paling baru duluan.
#[tauri::command]
pub async fn palette_recent() -> Vec<Entry> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(base) = std::env::var_os("APPDATA") else { return Vec::new() };
        let dir = PathBuf::from(base).join("Microsoft\\Windows\\Recent");
        let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
        let mut list: Vec<(SystemTime, Entry)> = entries
            .flatten()
            .filter_map(|e| {
                let path = e.path();
                let ext = path.extension()?.to_str()?.to_lowercase();
                if ext != "lnk" {
                    return None;
                }
                let name = path.file_stem()?.to_string_lossy().to_string();
                let modified = e.metadata().ok()?.modified().ok()?;
                Some((modified, Entry { name, path: path.to_string_lossy().to_string() }))
            })
            .collect();
        list.sort_by_key(|e| std::cmp::Reverse(e.0));
        list.into_iter().take(40).map(|(_, e)| e).collect()
    })
    .await
    .unwrap_or_default()
}

/// Shortcut palette dipencet: munculin notch, fokus, buka palette.
pub fn open(app: &AppHandle) {
    crate::island::set_paused(app, false);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_ignore_cursor_events(false);
        let _ = win.set_focus();
    }
    let _ = app.emit("palette-open", ());
}
