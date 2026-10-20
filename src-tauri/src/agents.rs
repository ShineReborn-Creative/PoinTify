//! Sesi Claude Code di terminal, dipantau dari notch.
//!
//! Hooks Claude Code menjalankan `pointify.exe --hook` (lihat `hook_relay`),
//! yang ngoper tiap kejadian ke server kecil di sini. Server ini:
//! - nyatet sesi yang lagi jalan dan langkah-langkahnya (tab Sesi),
//! - nahan permintaan izin dan pertanyaan Claude sampai dijawab dari notch,
//! - ngabarin frontend tiap ada perubahan.
//!
//! Server cuma dengerin di 127.0.0.1 dan tiap koneksi wajib bawa token acak
//! yang ditulis ke file alamat, jadi halaman web atau program lain nggak
//! bisa sembarangan ngirim kejadian palsu.

use crate::hook_relay::{endpoint_path, Endpoint};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    hash::{BuildHasher, Hasher},
    io::{BufRead, BufReader, ErrorKind, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

/// Batas nunggu jawaban dari notch. Sedikit di bawah timeout hook (300 dtk),
/// biar kita yang nyerah duluan dan Claude Code nampilin dialog biasa.
const ANSWER_WAIT: Duration = Duration::from_secs(290);
const MAX_STEPS: usize = 40;
const MAX_SESSIONS: usize = 8;
/// Sesi yang udah selesai dibuang dari daftar setelah sekian lama.
const ENDED_TTL_MS: u64 = 20 * 60_000;

// ---------------------------------------------------------------------------
// Data yang dikirim ke frontend
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: u64,
    pub at: u64,
    /// "prompt" | "tool"
    pub kind: String,
    pub tool: Option<String>,
    /// Ringkasan pendek: nama file, perintah, pola pencarian, isi prompt.
    pub detail: String,
    /// Jalur lengkap kalau langkahnya nyentuh file.
    pub target: Option<String>,
    pub added: Option<usize>,
    pub removed: Option<usize>,
    /// None = masih jalan, Some(true) = berhasil, Some(false) = gagal.
    pub ok: Option<bool>,
    #[serde(skip)]
    tool_use_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub cwd: String,
    pub project: String,
    /// "working" | "waiting" | "idle" | "ended"
    pub status: String,
    pub title: Option<String>,
    pub last_message: Option<String>,
    pub started_at: u64,
    pub updated_at: u64,
    pub steps: Vec<Step>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequest {
    pub id: String,
    /// "permission" | "question"
    pub kind: String,
    pub session_id: String,
    pub project: String,
    /// Diisi kalau datangnya dari chat PoinTify sendiri.
    pub chat_id: Option<String>,
    pub tool: String,
    pub detail: String,
    pub target: Option<String>,
    /// Ringkasan aturan "selalu izinkan" yang disaranin Claude Code, kalau ada.
    pub always_label: Option<String>,
    /// Buat pertanyaan: daftar pertanyaan dari AskUserQuestion.
    pub questions: Option<Value>,
    pub created_at: u64,
}

#[derive(Serialize, Clone, Default)]
pub struct Snapshot {
    pub sessions: Vec<AgentSession>,
    pub pending: Vec<PendingRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    /// "allow" | "always" | "deny" | "terminal" | "answer"
    pub action: String,
    #[serde(default)]
    pub answers: Option<HashMap<String, String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Finished {
    session_id: String,
    project: String,
    message: String,
    ok: bool,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct Waiting {
    info: PendingRequest,
    tx: mpsc::Sender<Answer>,
}

#[derive(Default)]
pub struct AgentsState {
    sessions: Mutex<Vec<AgentSession>>,
    pending: Mutex<Vec<Waiting>>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<AgentsState>();
    let sessions = state.sessions.lock().unwrap().clone();
    let pending = state.pending.lock().unwrap().iter().map(|w| w.info.clone()).collect();
    Snapshot { sessions, pending }
}

fn publish(app: &AppHandle) {
    let _ = app.emit("agents-changed", snapshot(app));
}

/// Token acak tanpa crate tambahan: `RandomState` diisi kunci acak dari OS.
fn random_token() -> String {
    let mut out = String::new();
    for i in 0..2u64 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(i ^ now_ms());
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

pub fn start(app: &AppHandle) {
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[pointify] server hooks gagal nyala: {e}");
            return;
        }
    };
    let Ok(port) = listener.local_addr().map(|a| a.port()) else {
        return;
    };
    let token = random_token();
    if let Some(path) = endpoint_path() {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let ep = Endpoint { port, token: token.clone() };
        if let Ok(s) = serde_json::to_string(&ep) {
            let _ = std::fs::write(&path, s);
        }
    }

    let app = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let token = token.clone();
            thread::spawn(move || {
                if let Err(e) = handle(&app, stream, &token) {
                    eprintln!("[pointify] hook: {e}");
                }
            });
        }
    });
}

fn handle(app: &AppHandle, stream: TcpStream, token: &str) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();

    reader.read_line(&mut line)?;
    if line.trim_end() != token {
        return Ok(());
    }
    line.clear();
    reader.read_line(&mut line)?;
    let chat_id = Some(line.trim().to_string()).filter(|s| !s.is_empty());
    line.clear();
    reader.read_line(&mut line)?;
    let Ok(event) = serde_json::from_str::<Value>(line.trim()) else {
        return Ok(());
    };

    let reply = on_event(app, &stream, event, chat_id);
    let mut stream = stream;
    let mut body = reply.map(|v| v.to_string()).unwrap_or_default();
    body.push('\n');
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn project_name(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Claude Code".into())
}

/// Jalankan satu kejadian hook. Balikin JSON yang harus dicetak relay, atau
/// None kalau Claude Code dibiarkan jalan seperti biasa.
fn on_event(app: &AppHandle, stream: &TcpStream, ev: Value, chat_id: Option<String>) -> Option<Value> {
    let name = str_of(&ev, "hook_event_name").to_string();
    let session_id = str_of(&ev, "session_id").to_string();
    let cwd = str_of(&ev, "cwd").to_string();
    let from_chat = chat_id.is_some();

    match name.as_str() {
        "PermissionRequest" => {
            let tool = str_of(&ev, "tool_name").to_string();
            let input = ev.get("tool_input").cloned().unwrap_or(Value::Null);
            let (detail, target) = describe(&tool, &input);
            let suggestions = ev
                .get("permission_suggestions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let info = PendingRequest {
                id: format!("p{}", next_id()),
                kind: "permission".into(),
                session_id: session_id.clone(),
                project: project_name(&cwd),
                chat_id,
                tool: tool.clone(),
                detail,
                target,
                always_label: always_label(&suggestions),
                questions: None,
                created_at: now_ms(),
            };
            if !from_chat {
                touch_session(app, &session_id, &cwd, |s| s.status = "waiting".into());
            }
            let answer = wait_for_answer(app, stream, info);
            if !from_chat {
                touch_session(app, &session_id, &cwd, |s| s.status = "working".into());
                publish(app);
            }
            answer.and_then(|a| permission_reply(&a, &suggestions))
        }

        "PreToolUse" => {
            let tool = str_of(&ev, "tool_name").to_string();
            let input = ev.get("tool_input").cloned().unwrap_or(Value::Null);
            if !from_chat {
                let (detail, target) = describe(&tool, &input);
                let tool_use_id = ev.get("tool_use_id").and_then(Value::as_str).map(String::from);
                touch_session(app, &session_id, &cwd, |s| {
                    s.status = "working".into();
                    push_step(s, Step {
                        id: next_id(),
                        at: now_ms(),
                        kind: "tool".into(),
                        tool: Some(tool.clone()),
                        detail,
                        target,
                        added: None,
                        removed: None,
                        ok: None,
                        tool_use_id,
                    });
                });
                publish(app);
            }
            // Pertanyaan pilihan ganda: tahan dan jawab dari notch.
            if tool == "AskUserQuestion" && !from_chat {
                let questions = input.get("questions").cloned()?;
                let info = PendingRequest {
                    id: format!("q{}", next_id()),
                    kind: "question".into(),
                    session_id: session_id.clone(),
                    project: project_name(&cwd),
                    chat_id: None,
                    tool,
                    detail: String::new(),
                    target: None,
                    always_label: None,
                    questions: Some(questions),
                    created_at: now_ms(),
                };
                touch_session(app, &session_id, &cwd, |s| s.status = "waiting".into());
                let answer = wait_for_answer(app, stream, info);
                touch_session(app, &session_id, &cwd, |s| s.status = "working".into());
                publish(app);
                return answer.and_then(|a| question_reply(&a, &input));
            }
            None
        }

        "PostToolUse" | "PostToolUseFailure" if !from_chat => {
            let ok = name == "PostToolUse";
            let tool = str_of(&ev, "tool_name").to_string();
            let input = ev.get("tool_input").cloned().unwrap_or(Value::Null);
            let id = ev.get("tool_use_id").and_then(Value::as_str).map(String::from);
            let (added, removed) = if ok { diff_counts(&tool, &input) } else { (None, None) };
            touch_session(app, &session_id, &cwd, |s| {
                if let Some(step) = s.steps.iter_mut().rev().find(|st| st.tool_use_id.is_some() && st.tool_use_id == id) {
                    step.ok = Some(ok);
                    step.added = added;
                    step.removed = removed;
                }
            });
            publish(app);
            None
        }

        "UserPromptSubmit" if !from_chat => {
            let prompt = str_of(&ev, "prompt").trim().to_string();
            let title = ev.get("session_title").and_then(Value::as_str).map(String::from);
            touch_session(app, &session_id, &cwd, |s| {
                s.status = "working".into();
                if title.is_some() {
                    s.title = title.clone();
                }
                push_step(s, Step {
                    id: next_id(),
                    at: now_ms(),
                    kind: "prompt".into(),
                    tool: None,
                    detail: clip(&prompt, 240),
                    target: None,
                    added: None,
                    removed: None,
                    ok: Some(true),
                    tool_use_id: None,
                });
            });
            publish(app);
            None
        }

        "SessionStart" if !from_chat => {
            let title = ev.get("session_title").and_then(Value::as_str).map(String::from);
            touch_session(app, &session_id, &cwd, |s| {
                if s.status == "ended" {
                    s.status = "idle".into();
                }
                if title.is_some() {
                    s.title = title.clone();
                }
            });
            publish(app);
            None
        }

        "Stop" | "StopFailure" if !from_chat => {
            let ok = name == "Stop";
            let message = clip(str_of(&ev, "last_assistant_message").trim(), 400);
            touch_session(app, &session_id, &cwd, |s| {
                s.status = "idle".into();
                if !message.is_empty() {
                    s.last_message = Some(message.clone());
                }
                // Langkah yang belum kelar dianggap beres.
                for st in s.steps.iter_mut().filter(|st| st.ok.is_none()) {
                    st.ok = Some(ok);
                }
            });
            publish(app);
            let _ = app.emit(
                "agent-finished",
                Finished { session_id, project: project_name(&cwd), message, ok },
            );
            None
        }

        "Notification" if !from_chat => {
            if str_of(&ev, "notification_type") == "idle_prompt" {
                touch_session(app, &session_id, &cwd, |s| s.status = "idle".into());
                publish(app);
            }
            None
        }

        "SessionEnd" if !from_chat => {
            touch_session(app, &session_id, &cwd, |s| s.status = "ended".into());
            publish(app);
            None
        }

        _ => None,
    }
}

/// Cari (atau bikin) sesi, ubah, lalu rapihin daftar.
fn touch_session(app: &AppHandle, id: &str, cwd: &str, f: impl FnOnce(&mut AgentSession)) {
    if id.is_empty() {
        return;
    }
    let state = app.state::<AgentsState>();
    let mut sessions = state.sessions.lock().unwrap();
    let now = now_ms();
    let idx = match sessions.iter().position(|s| s.id == id) {
        Some(i) => i,
        None => {
            sessions.insert(0, AgentSession {
                id: id.to_string(),
                cwd: cwd.to_string(),
                project: project_name(cwd),
                status: "idle".into(),
                title: None,
                last_message: None,
                started_at: now,
                updated_at: now,
                steps: Vec::new(),
            });
            0
        }
    };
    let s = &mut sessions[idx];
    f(s);
    s.updated_at = now;
    if !cwd.is_empty() && s.cwd != cwd {
        s.cwd = cwd.to_string();
        s.project = project_name(cwd);
    }
    sessions.retain(|s| !(s.status == "ended" && now.saturating_sub(s.updated_at) > ENDED_TTL_MS));
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions.truncate(MAX_SESSIONS);
}

fn push_step(s: &mut AgentSession, step: Step) {
    s.steps.push(step);
    if s.steps.len() > MAX_STEPS {
        let extra = s.steps.len() - MAX_STEPS;
        s.steps.drain(0..extra);
    }
}

/// Tahan koneksi sampai pengguna jawab di notch. Balikin None kalau Claude
/// Code udah nggak nunggu lagi (koneksi putus) atau waktunya habis.
fn wait_for_answer(app: &AppHandle, stream: &TcpStream, info: PendingRequest) -> Option<Answer> {
    let id = info.id.clone();
    let (tx, rx) = mpsc::channel();
    app.state::<AgentsState>().pending.lock().unwrap().push(Waiting { info, tx });
    publish(app);

    let started = Instant::now();
    let answer = loop {
        match rx.recv_timeout(Duration::from_millis(400)) {
            Ok(a) => break Some(a),
            Err(mpsc::RecvTimeoutError::Disconnected) => break None,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if started.elapsed() > ANSWER_WAIT || peer_closed(stream) {
            break None;
        }
    };

    app.state::<AgentsState>().pending.lock().unwrap().retain(|w| w.info.id != id);
    publish(app);
    answer
}

/// Relay nggak pernah ngirim apa-apa lagi setelah kejadiannya, jadi kalau
/// socket kebaca "selesai" artinya prosesnya udah dimatiin Claude Code.
fn peer_closed(stream: &TcpStream) -> bool {
    if stream.set_nonblocking(true).is_err() {
        return false;
    }
    let mut buf = [0u8; 1];
    let closed = match stream.peek(&mut buf) {
        Ok(0) => true,
        Ok(_) => false,
        Err(e) => e.kind() != ErrorKind::WouldBlock,
    };
    let _ = stream.set_nonblocking(false);
    closed
}

fn permission_reply(answer: &Answer, suggestions: &[Value]) -> Option<Value> {
    let decision = match answer.action.as_str() {
        "allow" => json!({ "behavior": "allow" }),
        "always" if !suggestions.is_empty() => json!({
            "behavior": "allow",
            "updatedPermissions": suggestions,
        }),
        "always" => json!({ "behavior": "allow" }),
        "deny" => json!({
            "behavior": "deny",
            "message": "Ditolak lewat PoinTify. Tanya dulu ke pengguna kalau perlu cara lain.",
        }),
        // "terminal": biarin Claude Code nampilin dialog biasa.
        _ => return None,
    };
    Some(json!({
        "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision }
    }))
}

fn question_reply(answer: &Answer, input: &Value) -> Option<Value> {
    if answer.action != "answer" {
        return None;
    }
    let answers = answer.answers.clone().filter(|a| !a.is_empty())?;
    let mut updated = input.clone();
    if let Some(obj) = updated.as_object_mut() {
        obj.insert("answers".into(), json!(answers));
    }
    Some(json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": "Dijawab lewat PoinTify",
            "updatedInput": updated,
        }
    }))
}

/// Contoh: `Bash(npm run *)` atau "mode terima edit".
fn always_label(suggestions: &[Value]) -> Option<String> {
    let first = suggestions.first()?;
    match str_of(first, "type") {
        "addRules" => {
            let rules = first.get("rules")?.as_array()?;
            let labels: Vec<String> = rules
                .iter()
                .map(|r| match r.get("ruleContent").and_then(Value::as_str) {
                    Some(c) if !c.is_empty() => format!("{}({})", str_of(r, "toolName"), c),
                    _ => str_of(r, "toolName").to_string(),
                })
                .collect();
            Some(labels.join(", ")).filter(|s| !s.is_empty())
        }
        "setMode" => Some(format!("mode {}", str_of(first, "mode"))),
        "addDirectories" => Some("akses folder ini".into()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Ringkasan tool
// ---------------------------------------------------------------------------

fn clip(s: &str, max: usize) -> String {
    let one = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= max {
        one
    } else {
        let cut: String = one.chars().take(max.saturating_sub(1)).collect();
        format!("{cut}…")
    }
}

fn base_name(p: &str) -> String {
    p.rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

/// (ringkasan, jalur lengkap)
fn describe(tool: &str, input: &Value) -> (String, Option<String>) {
    let s = |k: &str| str_of(input, k);
    match tool {
        "Bash" | "PowerShell" => {
            let cmd = s("command");
            (clip(if cmd.is_empty() { s("description") } else { cmd }, 200), None)
        }
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            let path = if s("file_path").is_empty() { s("notebook_path") } else { s("file_path") };
            (base_name(path), Some(path.to_string()).filter(|p| !p.is_empty()))
        }
        "Grep" | "Glob" => (clip(s("pattern"), 120), None),
        "WebFetch" => (clip(s("url"), 120), None),
        "WebSearch" => (clip(s("query"), 120), None),
        "Task" | "Agent" => (clip(s("description"), 120), None),
        "Skill" => (clip(s("skill"), 80), None),
        _ => {
            let first = input
                .as_object()
                .and_then(|o| o.values().find_map(|v| v.as_str()))
                .unwrap_or("");
            (clip(first, 120), None)
        }
    }
}

fn line_count(s: &str) -> usize {
    if s.is_empty() { 0 } else { s.lines().count().max(1) }
}

fn diff_counts(tool: &str, input: &Value) -> (Option<usize>, Option<usize>) {
    match tool {
        "Edit" => (
            Some(line_count(str_of(input, "new_string"))),
            Some(line_count(str_of(input, "old_string"))),
        ),
        "MultiEdit" => {
            let edits = input.get("edits").and_then(Value::as_array).cloned().unwrap_or_default();
            let add = edits.iter().map(|e| line_count(str_of(e, "new_string"))).sum();
            let rem = edits.iter().map(|e| line_count(str_of(e, "old_string"))).sum();
            (Some(add), Some(rem))
        }
        "Write" => (Some(line_count(str_of(input, "content"))), None),
        _ => (None, None),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agents_snapshot(app: AppHandle) -> Snapshot {
    snapshot(&app)
}

#[tauri::command]
pub fn agents_respond(state: State<AgentsState>, id: String, answer: Answer) -> Result<(), String> {
    let pending = state.pending.lock().unwrap();
    let w = pending.iter().find(|w| w.info.id == id).ok_or("Permintaan ini udah nggak berlaku")?;
    w.tx.send(answer).map_err(|_| "Claude udah nggak nunggu jawaban ini".to_string())
}

#[tauri::command]
pub fn agents_dismiss(app: AppHandle, session_id: String) {
    app.state::<AgentsState>().sessions.lock().unwrap().retain(|s| s.id != session_id);
    publish(&app);
}
