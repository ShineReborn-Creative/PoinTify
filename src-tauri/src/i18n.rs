//! Bahasa teks dari sisi Rust (menu tray, pesan error yang nongol di UI).
//! Frontend punya `src/i18n.ts` sendiri; dua-duanya baca pengaturan `language`.

use std::sync::atomic::{AtomicBool, Ordering};

static EN: AtomicBool = AtomicBool::new(false);

/// `pref`: "id", "en", atau "auto" (ikut bahasa tampilan Windows).
pub fn set_from(pref: &str) -> bool {
    let en = match pref {
        "en" => true,
        "id" => false,
        _ => !system_is_indonesian(),
    };
    EN.swap(en, Ordering::Relaxed) != en
}

pub fn en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// Pilih teks sesuai bahasa yang aktif.
pub fn tr<'a>(id: &'a str, en: &'a str) -> &'a str {
    if self::en() { en } else { id }
}

#[cfg(windows)]
fn system_is_indonesian() -> bool {
    // Bahasa utama ada di 10 bit bawah LANGID; 0x21 = Indonesia.
    let lang = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    lang & 0x3ff == 0x21
}

#[cfg(not(windows))]
fn system_is_indonesian() -> bool {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .find(|v| !v.is_empty())
        .is_some_and(|v| v.starts_with("id"))
}
