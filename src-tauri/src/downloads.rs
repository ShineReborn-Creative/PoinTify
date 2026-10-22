//! Progres download di notch: mantau folder Downloads, nyari file sementara
//! punya browser (`.crdownload` Chrome/Edge/Brave/Opera, `.part` Firefox), terus
//! ngabarin ukuran + kecepatannya. Isi file nggak pernah dibaca, cuma nama & ukuran.

use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const POLL: Duration = Duration::from_millis(1200);
const TEMP_EXT: &[&str] = &[".crdownload", ".part", ".opdownload", ".partial"];

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub id: String,
    /// Nama file akhirnya (tanpa ekstensi sementara).
    pub name: String,
    pub bytes: u64,
    /// Byte per detik (rata-rata beberapa detik terakhir).
    pub speed: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub name: String,
    pub path: String,
    pub bytes: u64,
}

struct Track {
    bytes: u64,
    speed: f64,
    at: Instant,
}

/// "film.mp4.crdownload" → "film.mp4". Chrome kadang mulai dari "Unconfirmed 123.crdownload".
pub(crate) fn final_name(temp: &str) -> Option<String> {
    let lower = temp.to_lowercase();
    let ext = TEMP_EXT.iter().find(|e| lower.ends_with(*e))?;
    Some(temp[..temp.len() - ext.len()].to_string())
}

fn downloads_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().download_dir().ok().filter(|p| p.is_dir())
}

fn scan(dir: &Path) -> Vec<(PathBuf, String, u64)> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let fin = final_name(&name)?;
            let meta = e.metadata().ok()?;
            meta.is_file().then(|| (e.path(), fin, meta.len()))
        })
        .collect()
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut tracks: HashMap<PathBuf, Track> = HashMap::new();
        let mut last: Vec<Download> = Vec::new();
        loop {
            thread::sleep(POLL);
            let on = crate::settings::current(&app).download_watch;
            let Some(dir) = downloads_dir(&app).filter(|_| on) else {
                if !last.is_empty() {
                    last.clear();
                    tracks.clear();
                    let _ = app.emit("downloads", &last);
                }
                continue;
            };
            let now = Instant::now();
            let found = scan(&dir);

            // File sementara yang hilang: kalau file akhirnya ada, berarti beres.
            let gone: Vec<PathBuf> = tracks.keys().filter(|p| !found.iter().any(|(f, _, _)| f == *p)).cloned().collect();
            for temp in gone {
                let t = tracks.remove(&temp);
                let name = temp.file_name().map(|n| n.to_string_lossy().to_string()).and_then(|n| final_name(&n));
                let Some(name) = name else { continue };
                let done = temp.with_file_name(&name);
                // "Unconfirmed 123.crdownload" ilang = Chrome ganti nama ke file aslinya, bukan beres.
                if name.starts_with("Unconfirmed ") {
                    continue;
                }
                if let Ok(meta) = fs::metadata(&done)
                    && meta.len() > 0
                {
                    let _ = app.emit(
                        "download-done",
                        Finished { name, path: done.to_string_lossy().to_string(), bytes: meta.len().max(t.map(|t| t.bytes).unwrap_or(0)) },
                    );
                }
            }

            let mut list = Vec::new();
            for (path, name, bytes) in found {
                let t = tracks.entry(path.clone()).or_insert(Track { bytes, speed: 0.0, at: now });
                let dt = now.duration_since(t.at).as_secs_f64();
                if dt > 0.3 {
                    let rate = bytes.saturating_sub(t.bytes) as f64 / dt;
                    // Dihaluskan biar angkanya nggak loncat-loncat.
                    t.speed = if t.speed == 0.0 { rate } else { t.speed * 0.6 + rate * 0.4 };
                    t.bytes = bytes;
                    t.at = now;
                }
                list.push(Download { id: path.to_string_lossy().to_string(), name, bytes, speed: t.speed as u64 });
            }
            list.sort_by(|a, b| a.name.cmp(&b.name));
            if list != last {
                let _ = app.emit("downloads", &list);
                last = list;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{final_name, scan};

    #[test]
    fn cuma_file_sementara_yang_kebaca() {
        let dir = std::env::temp_dir().join(format!("pointify-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("film.mp4.crdownload"), vec![0u8; 1234]).unwrap();
        std::fs::write(dir.join("lagu.mp3"), b"x").unwrap();
        let found = scan(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, "film.mp4");
        assert_eq!(found[0].2, 1234);
    }

    #[test]
    fn nama_akhir_download() {
        assert_eq!(final_name("film.mp4.crdownload").as_deref(), Some("film.mp4"));
        assert_eq!(final_name("setup.exe.part").as_deref(), Some("setup.exe"));
        assert_eq!(final_name("Lagu.MP3.CRDOWNLOAD").as_deref(), Some("Lagu.MP3"));
        assert_eq!(final_name("catatan.txt"), None);
    }
}
