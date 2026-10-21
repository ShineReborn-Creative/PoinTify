//! Riwayat clipboard buat widget Clipboard.
//!
//! Cuma teks, cuma disimpan di memori (hilang pas PoinTify ditutup), isi
//! yang ditandai "jangan dipantau" (biasanya dari password manager)
//! dilewatin, dan cuma dipantau selama widget Clipboard ada di Beranda.

use serde::Serialize;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

/// Lagi mantau clipboard atau nggak (nyala cuma kalau widget-nya dipasang).
static WATCH: AtomicBool = AtomicBool::new(false);
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg_attr(not(windows), allow(dead_code))]
const MAX_ITEMS: usize = 12;
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_CHARS: usize = 4000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub text: String,
    pub at: u64,
}

#[derive(Default)]
pub struct ClipState(Mutex<Vec<ClipItem>>);

#[cfg_attr(not(windows), allow(dead_code))]
fn now_ms() -> u64 {
    crate::agents::now_ms()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn remember(app: &AppHandle, text: String) {
    let text: String = text.chars().take(MAX_CHARS).collect();
    if text.trim().is_empty() {
        return;
    }
    let items = {
        let state = app.state::<ClipState>();
        let mut items = state.0.lock().unwrap();
        items.retain(|i| i.text != text);
        items.insert(0, ClipItem { text, at: now_ms() });
        items.truncate(MAX_ITEMS);
        items.clone()
    };
    let _ = app.emit_to("main", "clipboard-changed", items);
}

#[cfg(windows)]
mod imp {
    use std::{thread, time::Duration};
    use tauri::AppHandle;
    use windows::{
        Win32::{
            Foundation::{HANDLE, HGLOBAL},
            System::{
                DataExchange::{
                    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
                    OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
                },
                Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
                Ole::CF_UNICODETEXT,
            },
        },
        core::w,
    };

    /// Buka clipboard, coba beberapa kali kalau lagi dipakai app lain.
    unsafe fn open() -> bool {
        for _ in 0..5 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return true;
            }
            thread::sleep(Duration::from_millis(30));
        }
        false
    }

    pub fn read_now() -> Option<String> {
        unsafe { read_text() }
    }

    unsafe fn read_text() -> Option<String> {
        let skip = unsafe { RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")) };
        if unsafe { !open() } {
            return None;
        }
        let result = (|| {
            if skip != 0 && unsafe { IsClipboardFormatAvailable(skip) }.is_ok() {
                return None;
            }
            unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32) }.ok()?;
            let handle = unsafe { GetClipboardData(CF_UNICODETEXT.0 as u32) }.ok()?;
            let mem = HGLOBAL(handle.0);
            let ptr = unsafe { GlobalLock(mem) } as *const u16;
            if ptr.is_null() {
                return None;
            }
            let mut len = 0usize;
            while unsafe { *ptr.add(len) } != 0 && len < 1_000_000 {
                len += 1;
            }
            let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(ptr, len) });
            let _ = unsafe { GlobalUnlock(mem) };
            Some(text)
        })();
        let _ = unsafe { CloseClipboard() };
        result
    }

    pub fn write_text(text: &str) -> Result<(), String> {
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            if !open() {
                return Err(crate::i18n::tr("Clipboard lagi dipakai app lain", "The clipboard is in use by another app").into());
            }
            let result = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| e.to_string())?;
                let mem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).map_err(|e| e.to_string())?;
                let ptr = GlobalLock(mem) as *mut u16;
                if ptr.is_null() {
                    return Err(crate::i18n::tr("Memori clipboard nggak kebuka", "Couldn't open clipboard memory").into());
                }
                std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
                let _ = GlobalUnlock(mem);
                SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(mem.0))).map_err(|e| e.to_string())?;
                Ok(())
            })();
            let _ = CloseClipboard();
            result
        }
    }

    pub fn start(app: AppHandle) {
        thread::spawn(move || {
            let mut last = 0u32;
            loop {
                if !super::WATCH.load(std::sync::atomic::Ordering::Relaxed) {
                    last = 0;
                    thread::sleep(Duration::from_millis(700));
                    continue;
                }
                let seq = unsafe { GetClipboardSequenceNumber() };
                if seq != last {
                    last = seq;
                    if let Some(text) = unsafe { read_text() } {
                        super::remember(&app, text);
                    }
                }
                thread::sleep(Duration::from_millis(700));
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn read_now() -> Option<String> {
        None
    }
    pub fn write_text(_text: &str) -> Result<(), String> {
        Err("Cuma ada di Windows".into())
    }
    pub fn start(_app: tauri::AppHandle) {}
}

pub fn start(app: &AppHandle) {
    imp::start(app.clone());
}

#[tauri::command]
pub fn clipboard_list(state: State<ClipState>) -> Vec<ClipItem> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn clipboard_copy(text: String) -> Result<(), String> {
    imp::write_text(&text)
}

#[tauri::command]
pub fn clipboard_clear(app: AppHandle, state: State<ClipState>) {
    state.0.lock().unwrap().clear();
    let _ = app.emit_to("main", "clipboard-changed", Vec::<ClipItem>::new());
}

/// Nyalain/matiin pemantauan. Dimatiin = riwayatnya langsung dibuang.
#[tauri::command]
pub fn clipboard_watch(app: AppHandle, state: State<ClipState>, on: bool) {
    let was = WATCH.swap(on, Ordering::Relaxed);
    if was && !on {
        state.0.lock().unwrap().clear();
        let _ = app.emit_to("main", "clipboard-changed", Vec::<ClipItem>::new());
    }
}

/// Isi clipboard sekarang (buat prompt cepat), tanpa nyimpen riwayat.
#[tauri::command]
pub fn clipboard_read() -> Option<String> {
    imp::read_now()
}
