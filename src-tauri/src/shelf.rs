//! Rak file: tempat naruh file sementara. File-nya nggak dipindah atau
//! disalin, rak cuma nyimpen alamatnya (disimpan di shelf.json).

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: String,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub is_dir: bool,
    pub added_at: u64,
}

#[derive(Default)]
pub struct ShelfState(pub Mutex<Vec<ShelfItem>>);

const MAX_ITEMS: usize = 40;
/// Ikon pratinjau pas file di-drag keluar dari rak.
const DRAG_ICON: &[u8] = include_bytes!("../icons/128x128.png");

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("shelf.json"))
}

fn persist(app: &AppHandle, items: &[ShelfItem]) {
    let Some(path) = store_path(app) else { return };
    if let Ok(json) = serde_json::to_string_pretty(items) {
        let _ = crate::settings::write_atomic(&path, &json);
    }
}

fn changed(app: &AppHandle, items: &[ShelfItem]) {
    persist(app, items);
    let _ = app.emit("shelf-changed", items);
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let items: Vec<ShelfItem> =
        store_path(app).and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    // Buang item yang file-nya udah nggak ada.
    let items: Vec<ShelfItem> = items.into_iter().filter(|i| Path::new(&i.path).exists()).collect();
    *app.state::<ShelfState>().0.lock().unwrap() = items;
    Ok(())
}

fn item_for(path: &Path) -> Option<ShelfItem> {
    let meta = fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    Some(ShelfItem {
        id: format!("{}-{}", now_ms(), name),
        path: path.to_string_lossy().to_string(),
        name,
        ext,
        size: if meta.is_dir() { 0 } else { meta.len() },
        is_dir: meta.is_dir(),
        added_at: now_ms(),
    })
}

fn find(state: &State<ShelfState>, id: &str) -> Result<ShelfItem, String> {
    state
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|i| i.id == id)
        .cloned()
        .ok_or_else(|| crate::i18n::tr("File-nya udah nggak ada di rak", "That file is no longer on the shelf").to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfDiagnose {
    /// PoinTify jalan sebagai Administrator. Windows (UIPI) ngeblok file yang
    /// diseret dari Explorer biasa ke app yang levelnya lebih tinggi.
    pub elevated: bool,
}

#[cfg(windows)]
fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut info = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut info as *mut TOKEN_ELEVATION as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && info.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
fn is_elevated() -> bool {
    false
}

#[tauri::command]
pub fn shelf_diagnose() -> ShelfDiagnose {
    ShelfDiagnose { elevated: is_elevated() }
}

#[tauri::command]
pub fn shelf_list(state: State<ShelfState>) -> Vec<ShelfItem> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn shelf_add(app: AppHandle, state: State<ShelfState>, paths: Vec<String>) -> Vec<ShelfItem> {
    let mut items = state.0.lock().unwrap();
    for raw in paths {
        let path = PathBuf::from(&raw);
        if items.iter().any(|i| Path::new(&i.path) == path) {
            continue;
        }
        if let Some(item) = item_for(&path) {
            items.insert(0, item);
        }
    }
    items.truncate(MAX_ITEMS);
    changed(&app, &items);
    items.clone()
}

#[tauri::command]
pub fn shelf_remove(app: AppHandle, state: State<ShelfState>, id: String) -> Vec<ShelfItem> {
    let mut items = state.0.lock().unwrap();
    items.retain(|i| i.id != id);
    changed(&app, &items);
    items.clone()
}

#[tauri::command]
pub fn shelf_clear(app: AppHandle, state: State<ShelfState>) -> Vec<ShelfItem> {
    let mut items = state.0.lock().unwrap();
    items.clear();
    changed(&app, &items);
    Vec::new()
}

#[tauri::command]
pub fn shelf_open(app: AppHandle, state: State<ShelfState>, id: String) -> Result<(), String> {
    let item = find(&state, &id)?;
    app.opener().open_path(&item.path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shelf_reveal(app: AppHandle, state: State<ShelfState>, id: String) -> Result<(), String> {
    let item = find(&state, &id)?;
    app.opener().reveal_item_in_dir(&item.path).map_err(|e| e.to_string())
}

/// Tulis ikon pratinjau drag ke folder cache dan kasih alamatnya.
#[tauri::command]
pub fn shelf_drag_icon(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("drag-icon.png");
    fs::write(&path, DRAG_ICON).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
