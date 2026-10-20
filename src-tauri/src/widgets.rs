//! Bantuan buat widget: ambil data dari internet (cuaca, jadwal sholat, kurs,
//! GitHub, widget kustom) dan buka shortcut peluncur.
//!
//! Request dijalanin dari Rust, bukan dari WebView, biar nggak kena aturan
//! CORS dan bisa pakai user-agent PoinTify.

use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: usize = 2 * 1024 * 1024;

#[tauri::command]
pub async fn http_get_json(url: String) -> Result<Value, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Alamatnya harus diawali http:// atau https://".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("PoinTify/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Nggak bisa nyambung: {e}"))?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Server bales {}", status.as_u16()));
    }
    if bytes.len() > MAX_BYTES {
        return Err("Datanya kegedean".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Balasannya bukan JSON".into())
}

/// Buka app, file, folder, atau link dari widget Peluncur.
#[tauri::command]
pub fn launch_open(app: AppHandle, target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("Shortcut-nya kosong".into());
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        app.opener().open_url(t, None::<&str>).map_err(|e| e.to_string())
    } else {
        app.opener().open_path(t, None::<&str>).map_err(|e| e.to_string())
    }
}
