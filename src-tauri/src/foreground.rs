//! App yang lagi lu pake (jendela paling depan), buat logo di pil notch.
//! Cuma nama exe + nama app-nya; isi jendela nggak pernah dibaca.

use serde::Serialize;

#[derive(Clone, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundApp {
    /// Lokasi lengkap exe (dipakai buat ambil ikonnya).
    pub exe: String,
    /// Nama yang enak dibaca, misalnya "Roblox" atau "Google Chrome".
    pub name: String,
}

/// Nama dari nama file kalau exe-nya nggak punya keterangan: "RobloxPlayerBeta.exe" → "RobloxPlayerBeta".
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn name_from_path(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    let mut c = stem.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

#[cfg(windows)]
mod imp {
    use super::{ForegroundApp, name_from_path};
    use std::{sync::Mutex, thread, time::Duration};
    use tauri::{AppHandle, Emitter};
    use windows::{
        Win32::{
            Foundation::{CloseHandle, HWND, LPARAM},
            Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
            System::Threading::{
                GetCurrentProcessId, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            },
            UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId},
        },
        core::{BOOL, HSTRING, PWSTR},
    };

    pub static CURRENT: Mutex<Option<ForegroundApp>> = Mutex::new(None);

    fn class_of(hwnd: HWND) -> String {
        let mut buf = [0u16; 128];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) } as usize;
        String::from_utf16_lossy(&buf[..n])
    }

    fn pid_of(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid
    }

    fn exe_of(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = vec![0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// "FileDescription" di info versi exe, misalnya "Google Chrome".
    fn describe(path: &str) -> Option<String> {
        unsafe {
            let file = HSTRING::from(path);
            let size = GetFileVersionInfoSizeW(&file, None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(&file, None, size, data.as_mut_ptr() as _).ok()?;
            let mut ptr = std::ptr::null_mut();
            let mut len = 0u32;
            if !VerQueryValueW(data.as_ptr() as _, &HSTRING::from("\\VarFileInfo\\Translation"), &mut ptr, &mut len).as_bool() || len < 4 {
                return None;
            }
            let lang = *(ptr as *const u16);
            let cp = *(ptr as *const u16).add(1);
            let key = format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription");
            if !VerQueryValueW(data.as_ptr() as _, &HSTRING::from(key), &mut ptr, &mut len).as_bool() || len == 0 {
                return None;
            }
            let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
            let text = String::from_utf16_lossy(s).trim_end_matches('\0').trim().to_string();
            (!text.is_empty()).then_some(text)
        }
    }

    /// App UWP (Kalkulator, Setelan, dll) dibungkus ApplicationFrameHost: ambil proses jendela anaknya.
    fn uwp_child_pid(hwnd: HWND, host: u32) -> Option<u32> {
        struct Find {
            host: u32,
            found: u32,
        }
        unsafe extern "system" fn each(child: HWND, lp: LPARAM) -> BOOL {
            let f = unsafe { &mut *(lp.0 as *mut Find) };
            let pid = pid_of(child);
            if pid != 0 && pid != f.host {
                f.found = pid;
                return BOOL(0);
            }
            BOOL(1)
        }
        let mut f = Find { host, found: 0 };
        unsafe {
            let _ = EnumChildWindows(Some(hwnd), Some(each), LPARAM(&mut f as *mut Find as isize));
        }
        (f.found != 0).then_some(f.found)
    }

    /// Jendela paling depan sekarang. `None` = desktop/taskbar; `Some(None)` = jendela PoinTify sendiri (diabaikan).
    fn snapshot(own: u32) -> Option<Option<ForegroundApp>> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() {
            return None;
        }
        let class = class_of(hwnd);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "PoinTifyDropCatcher") {
            return None;
        }
        let mut pid = pid_of(hwnd);
        if pid == own {
            return Some(None);
        }
        let mut exe = exe_of(pid)?;
        if exe.to_lowercase().ends_with("\\applicationframehost.exe") {
            pid = uwp_child_pid(hwnd, pid)?;
            exe = exe_of(pid)?;
        }
        let name = describe(&exe).unwrap_or_else(|| name_from_path(&exe));
        Some(Some(ForegroundApp { exe, name }))
    }

    pub fn start(app: &AppHandle) {
        let app = app.clone();
        thread::spawn(move || {
            let own = unsafe { GetCurrentProcessId() };
            let mut last: Option<ForegroundApp> = None;
            let mut cache: Vec<(String, String)> = Vec::new();
            loop {
                let next = match snapshot(own) {
                    // Notch/Pip/Pengaturan lagi diklik: tetap tampilin app sebelumnya.
                    Some(None) => last.clone(),
                    Some(Some(mut a)) => {
                        // Nama dari info versi lumayan berat: simpen per exe.
                        if let Some((_, n)) = cache.iter().find(|(e, _)| *e == a.exe) {
                            a.name = n.clone();
                        } else {
                            cache.push((a.exe.clone(), a.name.clone()));
                            if cache.len() > 64 {
                                cache.remove(0);
                            }
                        }
                        Some(a)
                    }
                    None => None,
                };
                if next != last {
                    *CURRENT.lock().unwrap() = next.clone();
                    let _ = app.emit("foreground-app", &next);
                    last = next;
                }
                thread::sleep(Duration::from_millis(700));
            }
        });
    }
}

#[cfg(windows)]
pub use imp::start;

#[cfg(not(windows))]
pub fn start(_app: &tauri::AppHandle) {}

#[tauri::command]
pub fn foreground_get() -> Option<ForegroundApp> {
    #[cfg(windows)]
    {
        imp::CURRENT.lock().unwrap().clone()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn nama_dari_exe() {
        assert_eq!(super::name_from_path("C:\\Games\\RobloxPlayerBeta.exe"), "RobloxPlayerBeta");
        assert_eq!(super::name_from_path("C:\\x\\code.exe"), "Code");
    }
}
