//! Masang dan nyopot hooks PoinTify di `~/.claude/settings.json`.
//!
//! Yang diubah cuma entri milik PoinTify (perintah `pointify.exe --hook`).
//! Hooks lain punya pengguna dibiarkan apa adanya, urutan kunci di file juga
//! dijaga. Sebelum nulis, file lama di-backup di sebelahnya.

use serde::Serialize;
use serde_json::{Map, Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

/// (nama kejadian, matcher, timeout detik)
const EVENTS: &[(&str, Option<&str>, u32)] = &[
    ("SessionStart", None, 10),
    ("UserPromptSubmit", None, 10),
    ("PreToolUse", Some("*"), 300),
    ("PermissionRequest", Some("*"), 300),
    ("PostToolUse", Some("*"), 10),
    ("PostToolUseFailure", Some("*"), 10),
    ("Notification", None, 10),
    ("Stop", None, 10),
    ("StopFailure", None, 10),
    ("SessionEnd", None, 5),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    /// "installed" | "outdated" | "partial" | "missing"
    pub state: String,
    pub settings_path: String,
    pub exe_path: String,
    /// Potongan JSON yang bakal ditambahin, buat ditunjukin sebelum dipasang.
    pub preview: String,
    pub error: Option<String>,
}

fn claude_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude"))
}

fn settings_path() -> Option<PathBuf> {
    claude_dir().map(|d| d.join("settings.json"))
}

fn exe_path() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| format!("{}: {e}", crate::i18n::tr("Lokasi PoinTify nggak ketemu", "Couldn't find PoinTify's location")))
}

fn is_ours(handler: &Value) -> bool {
    let cmd = handler.get("command").and_then(Value::as_str).unwrap_or("");
    let file = cmd.rsplit(['/', '\\']).next().unwrap_or("").to_lowercase();
    let has_flag = handler.get("args").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.as_str() == Some("--hook")));
    has_flag && (file == "pointify.exe" || file == "pointify")
}

/// `onFailure` baru dikenal Claude Code v2.1.295. Versi lama dikasih entri tanpa itu.
fn supports_on_failure(version: Option<&str>) -> bool {
    let Some(v) = version else { return true };
    let nums: Vec<u32> = v.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).take(3).filter_map(|p| p.parse().ok()).collect();
    match nums.as_slice() {
        [a, b, c, ..] => (*a, *b, *c) >= (2, 1, 295),
        _ => true,
    }
}

fn handler_for(exe: &Path, timeout: u32, on_failure: bool) -> Value {
    let mut h = json!({
        "type": "command",
        "command": exe.to_string_lossy(),
        "args": ["--hook"],
        "timeout": timeout,
    });
    if on_failure {
        h["onFailure"] = json!("continue");
    }
    h
}

fn group_for(event: &str, matcher: Option<&str>, handler: Value) -> (String, Value) {
    let mut g = Map::new();
    if let Some(m) = matcher {
        g.insert("matcher".into(), json!(m));
    }
    g.insert("hooks".into(), json!([handler]));
    (event.to_string(), Value::Object(g))
}

fn wanted(exe: &Path, on_failure: bool) -> Vec<(String, Value)> {
    EVENTS.iter().map(|(ev, m, t)| group_for(ev, *m, handler_for(exe, *t, on_failure))).collect()
}

fn read_settings(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(s) if s.trim().is_empty() => Ok(json!({})),
        Ok(s) => serde_json::from_str::<Value>(&s)
            .map_err(|e| {
                format!(
                    "{} ({e}). {}",
                    crate::i18n::tr("settings.json nggak kebaca", "Couldn't parse settings.json"),
                    crate::i18n::tr("Benerin dulu file-nya, baru pasang lagi.", "Fix the file first, then install again.")
                )
            })
            .and_then(|v| {
                if v.is_object() {
                    Ok(v)
                } else {
                    Err(crate::i18n::tr("Isi settings.json bukan objek JSON", "settings.json isn't a JSON object").into())
                }
            }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("{}: {e}", crate::i18n::tr("settings.json nggak bisa dibuka", "Couldn't open settings.json"))),
    }
}

/// Hapus semua handler milik PoinTify. Grup yang jadi kosong ikut dibuang.
fn strip_ours(settings: &mut Value) -> bool {
    let mut changed = false;
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else {
        return false;
    };
    for groups in hooks.values_mut() {
        let Some(list) = groups.as_array_mut() else { continue };
        for g in list.iter_mut() {
            if let Some(hs) = g.get_mut("hooks").and_then(Value::as_array_mut) {
                let before = hs.len();
                hs.retain(|h| !is_ours(h));
                changed |= hs.len() != before;
            }
        }
        list.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|h| !h.is_empty()));
    }
    hooks.retain(|_, v| v.as_array().is_none_or(|a| !a.is_empty()));
    if hooks.is_empty() {
        settings.as_object_mut().map(|o| o.remove("hooks"));
    }
    changed
}

/// Hitung keadaan pemasangan dari isi settings.
fn state_of(settings: &Value, exe: &Path) -> String {
    let exe = exe.to_string_lossy().to_lowercase();
    let mut ours_current = 0;
    let mut ours_other = 0;
    if let Some(hooks) = settings.get("hooks").and_then(Value::as_object) {
        for (event, groups) in hooks {
            if !EVENTS.iter().any(|(e, _, _)| e == event) {
                continue;
            }
            let found =
                groups.as_array().into_iter().flatten().flat_map(|g| g.get("hooks").and_then(Value::as_array).cloned().unwrap_or_default());
            for h in found.filter(is_ours) {
                let cmd = h.get("command").and_then(Value::as_str).unwrap_or("").to_lowercase();
                if cmd == exe { ours_current += 1 } else { ours_other += 1 }
            }
        }
    }
    if ours_current >= EVENTS.len() && ours_other == 0 {
        "installed".into()
    } else if ours_other > 0 {
        "outdated".into()
    } else if ours_current > 0 {
        "partial".into()
    } else {
        "missing".into()
    }
}

fn backup(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let name = format!(
        "{}.pointify-backup-{stamp}",
        path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "settings.json".into())
    );
    let dest = path.with_file_name(name);
    fs::copy(path, &dest)
        .map_err(|e| format!("{}: {e}", crate::i18n::tr("Backup settings.json gagal", "Couldn't back up settings.json")))?;
    Ok(Some(dest))
}

fn write_settings(path: &Path, settings: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    text.push('\n');
    // Tulis ke file sementara dulu, baru diganti, biar nggak setengah jadi.
    let tmp = path.with_extension("json.pointify-tmp");
    fs::write(&tmp, text).map_err(|e| format!("{}: {e}", crate::i18n::tr("Gagal nulis settings.json", "Couldn't write settings.json")))?;
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", crate::i18n::tr("Gagal nulis settings.json", "Couldn't write settings.json")))
}

fn status_inner(version: Option<&str>) -> HooksStatus {
    let path = settings_path();
    let exe = exe_path();
    let (Some(path), Ok(exe)) = (path, exe) else {
        return HooksStatus {
            state: "missing".into(),
            settings_path: String::new(),
            exe_path: String::new(),
            preview: String::new(),
            error: Some(crate::i18n::tr("Folder pengguna nggak ketemu", "User folder not found").into()),
        };
    };
    let mut preview = Map::new();
    for (ev, g) in wanted(&exe, supports_on_failure(version)) {
        preview.insert(ev, json!([g]));
    }
    let preview = serde_json::to_string_pretty(&json!({ "hooks": preview })).unwrap_or_default();
    match read_settings(&path) {
        Ok(s) => HooksStatus {
            state: state_of(&s, &exe),
            settings_path: path.to_string_lossy().into(),
            exe_path: exe.to_string_lossy().into(),
            preview,
            error: None,
        },
        Err(e) => HooksStatus {
            state: "missing".into(),
            settings_path: path.to_string_lossy().into(),
            exe_path: exe.to_string_lossy().into(),
            preview,
            error: Some(e),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub status: HooksStatus,
    pub backup_path: Option<String>,
}

fn install_inner(version: Option<&str>) -> Result<InstallResult, String> {
    let path = settings_path().ok_or(crate::i18n::tr("Folder pengguna nggak ketemu", "User folder not found"))?;
    let exe = exe_path()?;
    let mut settings = read_settings(&path)?;
    let backup_path = backup(&path)?;

    strip_ours(&mut settings);
    let obj = settings.as_object_mut().ok_or(crate::i18n::tr("Isi settings.json bukan objek JSON", "settings.json isn't a JSON object"))?;
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or(crate::i18n::tr(
        "Bagian \"hooks\" di settings.json bentuknya aneh",
        "The \"hooks\" section in settings.json looks malformed",
    ))?;
    for (ev, group) in wanted(&exe, supports_on_failure(version)) {
        let list = hooks.entry(ev).or_insert_with(|| json!([]));
        match list.as_array_mut() {
            Some(arr) => arr.push(group),
            None => {
                return Err(crate::i18n::tr(
                    "Bagian \"hooks\" di settings.json bentuknya aneh",
                    "The \"hooks\" section in settings.json looks malformed",
                )
                .into());
            }
        }
    }
    write_settings(&path, &settings)?;
    Ok(InstallResult { status: status_inner(version), backup_path: backup_path.map(|p| p.to_string_lossy().into()) })
}

fn uninstall_inner(version: Option<&str>) -> Result<InstallResult, String> {
    let path = settings_path().ok_or(crate::i18n::tr("Folder pengguna nggak ketemu", "User folder not found"))?;
    let mut settings = read_settings(&path)?;
    if !strip_ours(&mut settings) {
        return Ok(InstallResult { status: status_inner(version), backup_path: None });
    }
    let backup_path = backup(&path)?;
    write_settings(&path, &settings)?;
    Ok(InstallResult { status: status_inner(version), backup_path: backup_path.map(|p| p.to_string_lossy().into()) })
}

#[tauri::command]
pub async fn hooks_status(app: AppHandle) -> HooksStatus {
    tauri::async_runtime::spawn_blocking(move || {
        let v = crate::claude::version(&app);
        status_inner(v.as_deref())
    })
    .await
    .unwrap_or_else(|e| HooksStatus {
        state: "missing".into(),
        settings_path: String::new(),
        exe_path: String::new(),
        preview: String::new(),
        error: Some(e.to_string()),
    })
}

#[tauri::command]
pub async fn hooks_install(app: AppHandle) -> Result<InstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let v = crate::claude::version(&app);
        install_inner(v.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn hooks_uninstall(app: AppHandle) -> Result<InstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let v = crate::claude::version(&app);
        uninstall_inner(v.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_keeps_other_hooks_and_is_idempotent() {
        let exe = PathBuf::from(r"C:\Apps\PoinTify\pointify.exe");
        let mut s = json!({
            "model": "opus",
            "hooks": {
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "lint.sh" }] }]
            },
            "zzz": 1
        });
        for _ in 0..2 {
            strip_ours(&mut s);
            let hooks = s["hooks"].as_object_mut().unwrap();
            for (ev, g) in wanted(&exe, true) {
                hooks.entry(ev).or_insert_with(|| json!([])).as_array_mut().unwrap().push(g);
            }
        }
        assert_eq!(state_of(&s, &exe), "installed");
        assert_eq!(s["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
        assert_eq!(s["hooks"]["PreToolUse"][0]["hooks"][0]["command"], "lint.sh");
        let keys: Vec<_> = s.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, vec!["model", "hooks", "zzz"]);

        assert_eq!(state_of(&s, Path::new(r"D:\other\pointify.exe")), "outdated");

        assert!(strip_ours(&mut s));
        assert_eq!(s["hooks"].as_object().unwrap().len(), 1);
        assert_eq!(state_of(&s, &exe), "missing");
    }

    #[test]
    fn version_gate() {
        assert!(supports_on_failure(Some("2.1.296 (Claude Code)")));
        assert!(!supports_on_failure(Some("2.1.120 (Claude Code)")));
        assert!(supports_on_failure(None));
    }
}
