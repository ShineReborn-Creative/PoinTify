//! `pointify.exe --hook`: jembatan kecil antara hooks Claude Code dan PoinTify.
//!
//! Claude Code menjalankan perintah ini di setiap kejadian (prompt dikirim,
//! tool dipakai, minta izin, selesai) dan ngirim datanya lewat stdin. Relay
//! ini cuma ngoper data itu ke PoinTify yang lagi jalan lewat socket lokal,
//! lalu nyetak balasannya (misalnya "izinkan") ke stdout.
//!
//! Aturan paling penting: relay nggak boleh pernah ngeganggu Claude Code.
//! Kalau PoinTify nggak jalan atau ada yang aneh, relay langsung keluar
//! dengan kode 0 tanpa output, dan Claude Code lanjut seperti biasa.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    time::Duration,
};

/// Alamat server PoinTify, ditulis aplikasi tiap kali nyala.
#[derive(Serialize, Deserialize)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

/// Lokasi file alamat. Sengaja dihitung tanpa Tauri, karena relay jalan
/// sebagai proses terpisah yang nggak bikin aplikasi Tauri.
pub fn endpoint_path() -> Option<PathBuf> {
    const ID: &str = "com.ojan.pointify";
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")));
    base.map(|b| b.join(ID).join("hook-endpoint.json"))
}

/// Dijalankan dari `main` kalau ada argumen `--hook`. Selalu balikin 0.
pub fn run() -> i32 {
    let _ = relay();
    0
}

fn relay() -> Option<()> {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).ok()?;
    // Dikirim ulang dalam satu baris, biar protokolnya cukup "per baris".
    let event: Value = serde_json::from_str(&raw).ok()?;
    let line = serde_json::to_string(&event).ok()?;

    let endpoint: Endpoint = serde_json::from_str(&std::fs::read_to_string(endpoint_path()?).ok()?).ok()?;
    let addr = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    let _ = stream.set_nodelay(true);

    // Chat dari dalam PoinTify sendiri ditandai, biar nggak dobel muncul di tab Sesi.
    let chat = std::env::var("POINTIFY_CHAT").unwrap_or_default();
    let header = format!("{}\n{}\n{}\n", endpoint.token, chat.replace('\n', ""), line);
    stream.write_all(header.as_bytes()).ok()?;
    stream.flush().ok()?;

    // Balasan: satu baris JSON (atau kosong = "terserah Claude Code").
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply).ok()?;
    let reply = reply.trim();
    if !reply.is_empty() && serde_json::from_str::<Value>(reply).is_ok() {
        let mut out = std::io::stdout();
        let _ = out.write_all(reply.as_bytes());
        let _ = out.flush();
    }
    Some(())
}
