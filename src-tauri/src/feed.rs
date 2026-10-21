//! Kabar progres dari chat Claude (bukan Claude Code di terminal).
//!
//! Chat Claude di app desktop jalan di server, jadi PoinTify nggak bisa
//! ngintip ke dalamnya. Gantinya, selama chat nyambung ke PC ini, Claude
//! nulis file kabar kecil ke `~/.pointify/feed/<id>.json` tiap mulai kerja,
//! ganti tahap, nanya, dan selesai. Modul ini mantau folder itu dan
//! nampilinnya sebagai sesi di tab Sesi plus notif di notch.
//!
//! Format file (semua kolom selain `state` boleh kosong):
//! ```json
//! {
//!   "v": 1,
//!   "project": "PoinTify",
//!   "title": "Pantau progres chat dari notch",
//!   "request": "yang diminta pengguna, singkat",
//!   "state": "working | waiting | done | error",
//!   "note": "lagi ngapain sekarang",
//!   "message": "ringkasan akhir atau pertanyaan buat pengguna",
//!   "steps": [{ "label": "Nulis kode Rust", "state": "done | active | pending" }]
//! }
//! ```

use crate::agents::{self, AgentSession};
use serde::Deserialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, UNIX_EPOCH},
};
use tauri::AppHandle;

const POLL: Duration = Duration::from_millis(700);
/// Sesi chat yang nggak ada kabar selama ini disembunyiin dari daftar.
const SHOW_FOR_MS: u64 = 12 * 60 * 60_000;
/// File kabar yang lebih tua dari ini dibersihin.
const DELETE_AFTER_MS: u64 = 3 * 24 * 60 * 60_000;
/// Notif cuma buat kabar yang masih anget (biar pas PoinTify baru nyala
/// nggak keluar notif buat kerjaan kemarin).
const FRESH_MS: u64 = 3 * 60_000;

const README: &str = "Folder ini dipantau PoinTify.\r\n\
Claude nulis kabar progres kerjaannya di sini (satu file .json per chat),\r\n\
dan PoinTify nampilinnya di notch. Aman dihapus kapan aja.\r\n";

#[derive(Deserialize, Default)]
#[serde(default)]
struct FeedFile {
    project: String,
    title: String,
    request: String,
    /// `status` juga diterima, biar file yang salah nama kolom nggak bikin sesi nyangkut di "lagi kerja".
    #[serde(alias = "status")]
    state: String,
    #[serde(alias = "stage")]
    note: String,
    message: String,
    steps: Vec<FeedStep>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct FeedStep {
    label: String,
    state: String,
}

pub fn feed_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".pointify").join("feed"))
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let m = fs::metadata(path).ok()?.modified().ok()?;
    m.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

struct Seen {
    mtime: u64,
    state: String,
    started_at: u64,
}

pub fn start(app: &AppHandle) {
    let Some(dir) = feed_dir() else { return };
    let _ = fs::create_dir_all(&dir);
    let readme = dir.join("BACA AKU.txt");
    if !readme.exists() {
        let _ = fs::write(&readme, README);
    }

    let app = app.clone();
    thread::spawn(move || {
        let mut seen: HashMap<String, Seen> = HashMap::new();
        loop {
            scan(&app, &dir, &mut seen);
            thread::sleep(POLL);
        }
    });
}

fn scan(app: &AppHandle, dir: &Path, seen: &mut HashMap<String, Seen>) {
    let now = agents::now_ms();
    let mut present: Vec<String> = Vec::new();

    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
        let Some(mtime) = mtime_ms(&path) else { continue };
        let age = now.saturating_sub(mtime);

        if age > DELETE_AFTER_MS {
            let _ = fs::remove_file(&path);
            continue;
        }
        if age > SHOW_FOR_MS {
            continue;
        }
        present.push(stem.clone());

        if seen.get(&stem).is_some_and(|s| s.mtime == mtime) {
            continue;
        }
        // File bisa kebaca pas lagi ditulis: kalau JSON-nya belum utuh,
        // tunggu putaran berikutnya.
        let Some(feed) = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<FeedFile>(&t).ok()) else {
            continue;
        };

        let prev = seen.get(&stem);
        let started_at = prev.map(|p| p.started_at).unwrap_or(mtime);
        let prev_state = prev.map(|p| p.state.clone());
        let state = normalize(&feed.state);
        let fresh = age < FRESH_MS;
        let changed = prev_state.as_deref() != Some(state);

        let id = format!("chat:{stem}");
        let project = if feed.project.trim().is_empty() { "Chat Claude".to_string() } else { agents::clip(&feed.project, 40) };
        agents::put_session(app, to_session(&id, &project, &feed, state, started_at, mtime));

        if changed && fresh {
            let message = if feed.message.trim().is_empty() { feed.note.trim() } else { feed.message.trim() };
            match state {
                "done" => agents::emit_finished(app, &id, &project, message, true),
                "error" => agents::emit_finished(app, &id, &project, message, false),
                "waiting" => agents::emit_attention(app, &id, &project, message),
                _ => {}
            }
        }
        seen.insert(stem, Seen { mtime, state: state.to_string(), started_at });
    }

    // File yang hilang (dihapus atau kedaluwarsa): sesinya ikut dibuang.
    let gone: Vec<String> = seen.keys().filter(|k| !present.contains(k)).cloned().collect();
    for stem in gone {
        seen.remove(&stem);
        agents::remove_session(app, &format!("chat:{stem}"));
    }
}

fn normalize(state: &str) -> &'static str {
    match state.trim().to_lowercase().as_str() {
        "done" | "selesai" | "beres" => "done",
        "error" | "gagal" => "error",
        "waiting" | "nunggu" | "question" => "waiting",
        _ => "working",
    }
}

fn to_session(id: &str, project: &str, feed: &FeedFile, state: &str, started_at: u64, mtime: u64) -> AgentSession {
    let mut steps = Vec::new();
    let mut n = 0u64;
    let mut push = |kind: &str, detail: String, ok: Option<bool>| {
        n += 1;
        let mut s = agents::task_step(n, mtime, detail, ok);
        s.kind = kind.into();
        steps.push(s);
    };
    if !feed.request.trim().is_empty() {
        push("prompt", agents::clip(&feed.request, 240), Some(true));
    }
    for st in feed.steps.iter().filter(|s| !s.label.trim().is_empty()) {
        let label = agents::clip(&st.label, 140);
        match st.state.trim().to_lowercase().as_str() {
            "done" | "completed" => push("task", label, Some(true)),
            "failed" | "error" => push("task", label, Some(false)),
            "active" | "in_progress" => push("task", label, if state == "working" { None } else { Some(true) }),
            _ => push("todo", label, None),
        }
    }
    let status = match state {
        "working" => "working",
        "waiting" => "waiting",
        _ => "idle",
    };
    let message = match state {
        "working" => feed.note.trim(),
        _ if !feed.message.trim().is_empty() => feed.message.trim(),
        _ => feed.note.trim(),
    };
    AgentSession {
        id: id.into(),
        source: "chat".into(),
        cwd: String::new(),
        project: project.into(),
        status: status.into(),
        title: Some(agents::clip(&feed.title, 80)).filter(|t| !t.is_empty()),
        last_message: Some(agents::clip(message, 400)).filter(|m| !m.is_empty()),
        started_at,
        updated_at: mtime.max(started_at),
        steps,
    }
}
