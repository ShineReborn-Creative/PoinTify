//! Penangkap file yang diseret ke notch (khusus Windows).
//!
//! Jendela notch itu transparan dan tembus klik. Di kombinasi itu, target
//! drop bawaan WebView2 nggak bisa diandelin: Windows nampilin kursor
//! "dilarang" dan file-nya nggak pernah nyampe. Jadi PoinTify punya jendela
//! native kecil sendiri (tanpa WebView) yang cuma muncul pas ada sesuatu
//! diseret dari luar ke atas notch. Jendela ini hampir tembus pandang
//! (alpha 1/255), nempel pas di atas pulau, dan didaftarin sebagai target
//! drag-drop OLE. File yang dilepas diterusin ke frontend sebagai event
//! `native-file-drag`.

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeDrag {
    /// "enter" | "leave" | "drop"
    pub kind: String,
    pub paths: Vec<String>,
}

#[cfg(windows)]
mod imp {
    use super::NativeDrag;
    use std::{
        ptr,
        sync::{
            atomic::{AtomicBool, AtomicIsize, AtomicUsize, Ordering},
            Mutex, OnceLock,
        },
        thread,
    };
    use tauri::{AppHandle, Emitter};
    use windows::{
        core::{implement, w, Ref, Result},
        Win32::{
            Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINTL, WPARAM},
            System::{
                Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
                LibraryLoader::GetModuleHandleW,
                Ole::{
                    IDropTarget, IDropTarget_Impl, OleInitialize, RegisterDragDrop, ReleaseStgMedium, CF_HDROP,
                    DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
                },
                SystemServices::MODIFIERKEYS_FLAGS,
            },
            UI::{
                Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
                Shell::{DragQueryFileW, HDROP},
                WindowsAndMessaging::{
                    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
                    SetLayeredWindowAttributes, SetWindowPos, TranslateMessage, HWND_TOPMOST, LWA_ALPHA, MSG,
                    SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WINDOW_EX_STYLE,
                    WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
                },
            },
        },
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static HWND_RAW: AtomicIsize = AtomicIsize::new(0);
    static SHOWN: AtomicBool = AtomicBool::new(false);
    /// Penangkapnya lagi dipakai siapa: 0 = notch, 1 = Pip desktop.
    static OWNER: AtomicUsize = AtomicUsize::new(0);
    /// Kotak yang diminta masing-masing (notch, Pip).
    static SLOTS: Mutex<[Option<(i32, i32, i32, i32)>; 2]> = Mutex::new([None, None]);

    fn emit(kind: &str, paths: Vec<String>) {
        if let Some(app) = APP.get() {
            // Nama event-nya beda per jendela: `listen()` global di JS nerima
            // event buat jendela mana pun, jadi notch nggak boleh ikut ngerespon
            // file yang dikasih ke Pip (dan sebaliknya).
            let (to, event) = if OWNER.load(Ordering::Relaxed) == 1 { ("pet", "pet-file-drag") } else { ("main", "native-file-drag") };
            eprintln!("[pointify] penangkap file ({to}): {kind} ({} item)", paths.len());
            let _ = app.emit_to(to, event, NativeDrag { kind: kind.into(), paths });
        }
    }

    /// Ambil daftar file dari data yang diseret. None = bukan file.
    unsafe fn file_paths(data: Ref<'_, IDataObject>) -> Option<Vec<String>> {
        let data = data.as_ref()?;
        let format = FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let mut medium = unsafe { data.GetData(&format) }.ok()?;
        let hdrop = HDROP(unsafe { medium.u.hGlobal.0 } as _);
        let count = unsafe { DragQueryFileW(hdrop, 0xFFFF_FFFF, None) };
        let mut paths = Vec::with_capacity(count as usize);
        for i in 0..count {
            let len = unsafe { DragQueryFileW(hdrop, i, None) } as usize;
            let mut buf = vec![0u16; len + 1];
            unsafe { DragQueryFileW(hdrop, i, Some(&mut buf)) };
            paths.push(String::from_utf16_lossy(&buf[..len]));
        }
        unsafe { ReleaseStgMedium(&mut medium) };
        Some(paths)
    }

    #[implement(IDropTarget)]
    struct Catcher {
        valid: std::cell::Cell<bool>,
    }

    #[allow(non_snake_case)]
    impl IDropTarget_Impl for Catcher_Impl {
        fn DragEnter(
            &self,
            data: Ref<'_, IDataObject>,
            _keys: MODIFIERKEYS_FLAGS,
            _pt: &POINTL,
            effect: *mut DROPEFFECT,
        ) -> Result<()> {
            let paths = unsafe { file_paths(data) };
            let valid = paths.as_ref().is_some_and(|p| !p.is_empty());
            self.valid.set(valid);
            unsafe { *effect = if valid { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
            if let Some(p) = paths.filter(|_| valid) {
                emit("enter", p);
            }
            Ok(())
        }

        fn DragOver(&self, _keys: MODIFIERKEYS_FLAGS, _pt: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
            unsafe { *effect = if self.valid.get() { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
            Ok(())
        }

        fn DragLeave(&self) -> Result<()> {
            if self.valid.replace(false) {
                emit("leave", Vec::new());
            }
            Ok(())
        }

        fn Drop(&self, data: Ref<'_, IDataObject>, _keys: MODIFIERKEYS_FLAGS, _pt: &POINTL, effect: *mut DROPEFFECT) -> Result<()> {
            let paths = unsafe { file_paths(data) }.unwrap_or_default();
            self.valid.set(false);
            unsafe { *effect = if paths.is_empty() { DROPEFFECT_NONE } else { DROPEFFECT_COPY } };
            emit("drop", paths);
            Ok(())
        }
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
    }

    /// Bikin jendelanya di thread sendiri (OLE butuh thread STA dengan antrean pesan).
    pub fn start(app: &tauri::AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        thread::spawn(|| unsafe {
            if OleInitialize(None).is_err() {
                eprintln!("[pointify] penangkap file: OLE gagal dinyalain");
                return;
            }
            let Ok(module) = GetModuleHandleW(None) else { return };
            let class = w!("PoinTifyDropCatcher");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: module.into(),
                lpszClassName: class,
                ..Default::default()
            };
            RegisterClassW(&wc);
            let ex = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0 | WS_EX_NOACTIVATE.0);
            let Ok(hwnd) = CreateWindowExW(ex, class, w!("PoinTify"), WS_POPUP, 0, 0, 10, 10, None, None, Some(module.into()), None)
            else {
                eprintln!("[pointify] penangkap file: jendela gagal dibikin");
                return;
            };
            // Hampir tembus pandang, tapi tetap "kena" kursor dan bisa jadi target drop.
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 1, LWA_ALPHA);
            let target: IDropTarget = Catcher { valid: false.into() }.into();
            if let Err(e) = RegisterDragDrop(hwnd, &target) {
                eprintln!("[pointify] penangkap file: RegisterDragDrop gagal: {e}");
                return;
            }
            HWND_RAW.store(hwnd.0 as isize, Ordering::Relaxed);

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            drop(target);
        });
    }

    pub fn left_button_down() -> bool {
        unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
    }

    /// Notch minta penangkap di kotak ini (piksel fisik layar), atau None.
    pub fn place(rect: Option<(i32, i32, i32, i32)>) {
        place_for(0, rect);
    }

    /// Pip desktop minta penangkap di atas badannya, atau None.
    pub fn place_pet(rect: Option<(i32, i32, i32, i32)>) {
        place_for(1, rect);
    }

    fn place_for(owner: usize, rect: Option<(i32, i32, i32, i32)>) {
        let chosen = {
            let mut slots = SLOTS.lock().unwrap();
            slots[owner] = rect;
            // Pip didahulukan (kotaknya kecil dan cuma muncul pas file diseret ke atasnya).
            if let Some(r) = slots[1] {
                Some((1, r))
            } else {
                slots[0].map(|r| (0, r))
            }
        };
        // Pemilik cuma ganti pas penangkap lagi nggak dipakai nyeret, biar file nggak salah alamat.
        if let Some((o, _)) = chosen {
            if !SHOWN.load(Ordering::Relaxed) || o == 1 {
                OWNER.store(o, Ordering::Relaxed);
            }
        }
        show(chosen.map(|(_, r)| r));
    }

    fn show(rect: Option<(i32, i32, i32, i32)>) {
        let raw = HWND_RAW.load(Ordering::Relaxed);
        if raw == 0 {
            return;
        }
        let hwnd = HWND(raw as *mut core::ffi::c_void);
        unsafe {
            match rect {
                Some((x, y, w, h)) => {
                    SHOWN.store(true, Ordering::Relaxed);
                    let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w.max(1), h.max(1), SWP_NOACTIVATE | SWP_SHOWWINDOW);
                }
                None => {
                    if SHOWN.swap(false, Ordering::Relaxed) {
                        let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_HIDEWINDOW);
                    }
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn start(_app: &tauri::AppHandle) {}
    pub fn left_button_down() -> bool {
        false
    }
    pub fn place(_rect: Option<(i32, i32, i32, i32)>) {}
    pub fn place_pet(_rect: Option<(i32, i32, i32, i32)>) {}
}

pub use imp::{left_button_down, place, place_pet, start};
