//! Jembatan ke Claude Code: PoinTify menjalankan `claude -p` di folder
//! project yang dipilih, pakai login langganan Claude milik pengguna, dan
//! meneruskan aliran JSON-nya ke tampilan chat.
//!
//! Mode "chat" (Ngobrol) jalan di permission mode `plan`: Claude cuma boleh
//! baca. Mode "work" (Kerjain) pakai `acceptEdits`: Claude boleh ngedit file
//! di folder project.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};

const PERSONA: &str = include_str!("persona.md");

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct ClaudeState {
    /// chat_id -> PID proses `claude` yang lagi jalan.
    runs: Mutex<HashMap<String, u32>>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub account: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    pub chat_id: String,
    pub prompt: String,
    pub cwd: Option<String>,
    pub session_id: Option<String>,
    pub mode: String,
    pub model: String,
    pub effort: String,
    #[serde(default)]
    pub attachments: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeEvent {
    chat_id: String,
    event: Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeDone {
    chat_id: String,
    code: Option<i32>,
    stderr: String,
}

// ---------------------------------------------------------------------------
// Nyari program `claude`
// ---------------------------------------------------------------------------

fn candidates() -> Vec<PathBuf> {
    #[cfg(windows)]
    let names = ["claude.exe", "claude.cmd"];
    #[cfg(not(windows))]
    let names = ["claude", "claude"];

    let mut list = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in names {
                list.push(dir.join(name));
            }
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let bin = PathBuf::from(home).join(".local").join("bin");
        list.push(bin.join(names[0]));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        list.push(PathBuf::from(appdata).join("npm").join("claude.cmd"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        list.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join("claude.exe"));
    }
    list
}

fn resolve(app: &AppHandle) -> Option<PathBuf> {
    let custom = crate::settings::current(app).claude_path;
    if !custom.trim().is_empty() {
        let p = PathBuf::from(custom.trim());
        return p.is_file().then_some(p);
    }
    candidates().into_iter().find(|p| p.is_file())
}

/// Rust otomatis lewat cmd.exe dengan escaping aman kalau file-nya .cmd/.bat.
fn base_command(path: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn persona_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("claude-persona.md");
    fs::write(&path, PERSONA).map_err(|e| e.to_string())?;
    Ok(path)
}

fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    s[start..].to_string()
}

/// Aliran `stream_event` isinya banyak banget; yang dipakai tampilan cuma
/// awal blok dan potongan teks.
fn worth_forwarding(v: &Value) -> bool {
    if v.get("type").and_then(Value::as_str) != Some("stream_event") {
        return true;
    }
    let event = v.get("event");
    match event.and_then(|e| e.get("type")).and_then(Value::as_str) {
        Some("content_block_start") => true,
        Some("content_block_delta") => {
            event.and_then(|e| e.get("delta")).and_then(|d| d.get("type")).and_then(Value::as_str) == Some("text_delta")
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Versi Claude Code yang terpasang, misalnya "2.1.300 (Claude Code)".
pub fn version(app: &AppHandle) -> Option<String> {
    let path = resolve(app)?;
    base_command(&path)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn status_blocking(app: &AppHandle) -> ClaudeStatus {
    let Some(path) = resolve(app) else {
        return ClaudeStatus::default();
    };
    let version = base_command(&path)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    let auth = base_command(&path).args(["auth", "status"]).stdin(Stdio::null()).output().ok();
    let (logged_in, auth_method, account) = match auth {
        Some(out) => {
            let json: Option<Value> = serde_json::from_slice(&out.stdout).ok();
            let method = json.as_ref().and_then(|j| j.get("authMethod")).and_then(Value::as_str).map(String::from);
            let account = json.as_ref().and_then(|j| {
                ["email", "emailAddress", "account"].iter().find_map(|k| j.get(*k).and_then(Value::as_str).map(String::from))
            });
            let ok = out.status.success() && method.as_deref() != Some("none");
            (ok, method, account)
        }
        None => (false, None, None),
    };

    ClaudeStatus { installed: true, path: Some(path.to_string_lossy().to_string()), version, logged_in, auth_method, account }
}

#[tauri::command]
pub async fn claude_status(app: AppHandle) -> ClaudeStatus {
    tauri::async_runtime::spawn_blocking(move || status_blocking(&app)).await.unwrap_or_default()
}

#[tauri::command]
pub fn claude_send(app: AppHandle, state: State<ClaudeState>, req: SendRequest) -> Result<(), String> {
    let path = resolve(&app).ok_or(crate::i18n::tr("Claude Code belum terpasang di PC ini", "Claude Code isn't installed on this PC"))?;
    if state.runs.lock().unwrap().contains_key(&req.chat_id) {
        return Err(crate::i18n::tr("Claude masih ngerjain pesan sebelumnya", "Claude is still working on the previous message").into());
    }
    let persona = persona_file(&app)?;

    let mut cmd = base_command(&path);
    cmd.args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
    cmd.args(["--model", req.model.as_str()]);
    if req.model != "haiku" && !req.effort.is_empty() {
        cmd.args(["--effort", req.effort.as_str()]);
    }
    let permission = if req.mode == "work" { "acceptEdits" } else { "plan" };
    cmd.args(["--permission-mode", permission]);
    cmd.arg("--append-system-prompt-file").arg(&persona);
    if let Some(session) = req.session_id.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--resume", session]);
    }

    // File lampiran: kasih akses ke folder tempat file itu berada.
    let mut dirs: Vec<PathBuf> = Vec::new();
    for a in &req.attachments {
        let p = PathBuf::from(a);
        let dir = if p.is_dir() { Some(p) } else { p.parent().map(Path::to_path_buf) };
        if let Some(d) = dir.filter(|d| d.is_dir())
            && !dirs.contains(&d)
        {
            dirs.push(d);
        }
    }
    for d in &dirs {
        cmd.arg("--add-dir").arg(d);
    }

    let cwd = req
        .cwd
        .as_deref()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    // Ditandai biar hooks PoinTify tahu ini chat dari notch, bukan sesi terminal.
    cmd.env("POINTIFY_CHAT", &req.chat_id);
    cmd.current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child =
        cmd.spawn().map_err(|e| format!("{}: {e}", crate::i18n::tr("Gagal menjalankan Claude Code", "Couldn't start Claude Code")))?;

    // Prompt dikirim lewat stdin, biar aman dari urusan tanda kutip.
    let mut prompt = req.prompt.clone();
    if !req.attachments.is_empty() {
        prompt.push_str("\n\nFile yang dilampirkan:\n");
        for a in &req.attachments {
            prompt.push_str(&format!("- {a}\n"));
        }
    }
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }

    let chat_id = req.chat_id.clone();
    state.runs.lock().unwrap().insert(chat_id.clone(), child.id());

    let stdout = child.stdout.take().ok_or(crate::i18n::tr("stdout Claude nggak kebaca", "Couldn't read Claude's output"))?;
    let stderr = child.stderr.take();
    let err_reader = thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s);
        }
        s
    });

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<Value>(line)
                && worth_forwarding(&event)
            {
                let _ = app.emit("claude-event", ClaudeEvent { chat_id: chat_id.clone(), event });
            }
        }
        let code = child.wait().ok().and_then(|s| s.code());
        let stderr = err_reader.join().unwrap_or_default();
        app.state::<ClaudeState>().runs.lock().unwrap().remove(&chat_id);
        let _ = app.emit("claude-done", ClaudeDone { chat_id, code, stderr: tail(&stderr, 2000) });
    });

    Ok(())
}

#[tauri::command]
pub fn claude_stop(state: State<ClaudeState>, chat_id: String) {
    let pid = state.runs.lock().unwrap().get(&chat_id).copied();
    if let Some(pid) = pid {
        kill_tree(pid);
    }
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(CREATE_NO_WINDOW).status();
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

/// Buka jendela terminal buat login Claude (alurnya lewat browser).
#[tauri::command]
pub fn claude_login(app: AppHandle) -> Result<(), String> {
    let path = resolve(&app).ok_or(crate::i18n::tr("Claude Code belum terpasang di PC ini", "Claude Code isn't installed on this PC"))?;
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "Login Claude", "cmd", "/K"])
            .arg(&path)
            .args(["auth", "login"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        base_command(&path).args(["auth", "login"]).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lanjutin sesi yang sama di aplikasi Claude Desktop.
#[tauri::command]
pub fn claude_open_desktop(app: AppHandle, session_id: Option<String>, cwd: Option<String>) -> Result<(), String> {
    let path = resolve(&app).ok_or(crate::i18n::tr("Claude Code belum terpasang di PC ini", "Claude Code isn't installed on this PC"))?;
    let mut cmd = base_command(&path);
    cmd.arg("--desktop");
    if let Some(s) = session_id.as_deref().filter(|s| !s.is_empty()) {
        cmd.args(["--resume", s]);
    }
    let cwd = cwd.map(PathBuf::from).filter(|p| p.is_dir()).or_else(|| app.path().home_dir().ok());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
