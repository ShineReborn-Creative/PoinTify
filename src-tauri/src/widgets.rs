//! Bantuan buat widget: ambil data dari internet (cuaca, jadwal sholat, kurs,
//! GitHub, widget kustom) dan buka shortcut peluncur.
//!
//! Request dijalanin dari Rust, bukan dari WebView, biar nggak kena aturan
//! CORS dan bisa pakai user-agent PoinTify.

use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: usize = 2 * 1024 * 1024;

#[tauri::command]
pub async fn http_get_json(url: String) -> Result<Value, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Alamatnya harus diawali http:// atau https://".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("PoinTify/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).header("Accept", "application/json").send().await.map_err(|e| format!("Nggak bisa nyambung: {e}"))?;
    let status = res.status();
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Server bales {}", status.as_u16()));
    }
    if bytes.len() > MAX_BYTES {
        return Err("Datanya kegedean".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Balasannya bukan JSON".into())
}

/// Buka app, file, folder, atau link dari widget Peluncur.
#[tauri::command]
pub fn launch_open(app: AppHandle, target: String) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("Shortcut-nya kosong".into());
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        app.opener().open_url(t, None::<&str>).map_err(|e| e.to_string())
    } else {
        app.opener().open_path(t, None::<&str>).map_err(|e| e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Ikon buat widget Peluncur
// ---------------------------------------------------------------------------

use base64::Engine as _;
use std::{collections::HashMap, sync::Mutex};

static ICONS: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Ikon situs: favicon dari situsnya sendiri, kalau nggak ada dari DuckDuckGo.
async fn site_icon(url: &str) -> Option<String> {
    let host = url.split("://").nth(1)?.split(['/', '?', '#']).next()?.split('@').next_back()?.to_string();
    if host.is_empty() {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(concat!("PoinTify/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()?;
    let bare = host.split(':').next().unwrap_or(&host).to_string();
    for src in [format!("https://{host}/favicon.ico"), format!("https://icons.duckduckgo.com/ip3/{bare}.ico")] {
        let Ok(res) = client.get(&src).send().await else { continue };
        if !res.status().is_success() {
            continue;
        }
        let mime = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("image/x-icon")
            .split(';')
            .next()
            .unwrap_or("image/x-icon")
            .trim()
            .to_string();
        if !mime.starts_with("image/") && mime != "application/octet-stream" {
            continue;
        }
        let Ok(bytes) = res.bytes().await else { continue };
        if bytes.len() < 64 || bytes.len() > 512 * 1024 {
            continue;
        }
        let mime = if mime == "application/octet-stream" { "image/x-icon".to_string() } else { mime };
        return Some(data_url(&mime, &bytes));
    }
    None
}

/// Ikon asli app, file, folder, atau link (data URL PNG/ICO). `None` = pakai ikon bawaan PoinTify.
/// Hasilnya disimpen di memori, jadi tiap shortcut cuma diambil sekali.
#[tauri::command]
pub async fn launch_icon(target: String) -> Result<Option<String>, String> {
    let t = target.trim().to_string();
    if t.is_empty() {
        return Ok(None);
    }
    if let Some(hit) = ICONS.lock().unwrap().as_ref().and_then(|m| m.get(&t).cloned()) {
        return Ok(hit);
    }
    let icon = if t.starts_with("http://") || t.starts_with("https://") {
        site_icon(&t).await
    } else {
        let path = t.clone();
        tauri::async_runtime::spawn_blocking(move || shell::icon_png(&path).map(|png| data_url("image/png", &png)))
            .await
            .map_err(|e| e.to_string())?
    };
    // Yang gagal nggak disimpen, biar dicoba lagi lain kali.
    if icon.is_some() {
        ICONS.lock().unwrap().get_or_insert_with(HashMap::new).insert(t, icon.clone());
    }
    Ok(icon)
}

#[cfg(windows)]
mod shell {
    use std::{ffi::c_void, mem::size_of};
    use windows::{
        Win32::{
            Graphics::Gdi::{
                BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits, GetObjectW, HGDIOBJ,
                ReleaseDC,
            },
            Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
            System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
            UI::{
                Controls::{IImageList, ILD_TRANSPARENT},
                Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_SYSICONINDEX, SHGetFileInfoW, SHGetImageList, SHIL_EXTRALARGE},
                WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO, PrivateExtractIconsW},
            },
        },
        core::PCWSTR,
    };

    /// Ambil piksel bitmap jadi BGRA 32-bit (atas ke bawah).
    unsafe fn bits(bmp: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<(i32, i32, Vec<u8>)> {
        let mut bm = BITMAP::default();
        if unsafe { GetObjectW(HGDIOBJ(bmp.0), size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void)) } == 0 {
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        if w <= 0 || h <= 0 || w > 512 || h > 512 {
            return None;
        }
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let dc = unsafe { GetDC(None) };
        let lines = unsafe { GetDIBits(dc, bmp, 0, h as u32, Some(buf.as_mut_ptr() as *mut c_void), &mut info, DIB_RGB_COLORS) };
        unsafe { ReleaseDC(None, dc) };
        (lines > 0).then_some((w, h, buf))
    }

    unsafe fn to_rgba(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
        let mut ii = ICONINFO::default();
        unsafe { GetIconInfo(icon, &mut ii) }.ok()?;
        let color = if ii.hbmColor.is_invalid() { None } else { unsafe { bits(ii.hbmColor) } };
        let mask = if ii.hbmMask.is_invalid() { None } else { unsafe { bits(ii.hbmMask) } };
        unsafe {
            let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
            let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        }
        let (w, h, mut px) = color?;
        // BGRA -> RGBA
        for p in px.chunks_exact_mut(4) {
            p.swap(0, 2);
        }
        // Ikon lama tanpa alpha: transparansinya dari mask (putih = tembus).
        if px.chunks_exact(4).all(|p| p[3] == 0) {
            if let Some((mw, mh, m)) = mask.filter(|(mw, mh, _)| *mw == w && *mh >= h) {
                let _ = (mw, mh);
                for (p, mp) in px.chunks_exact_mut(4).zip(m.chunks_exact(4)) {
                    p[3] = if mp[0] > 127 { 0 } else { 255 };
                }
            } else {
                for p in px.chunks_exact_mut(4) {
                    p[3] = 255;
                }
            }
        }
        let (mut w, mut h) = (w as u32, h as u32);
        // Ikon yang cuma punya versi 32px ditaruh Windows di pojok kiri atas kanvas 48px: potong.
        if w == 48 && h == 48 {
            let outside = (0..48u32).flat_map(|y| (0..48u32).map(move |x| (x, y))).filter(|&(x, y)| x >= 32 || y >= 32);
            if outside.clone().all(|(x, y)| px[((y * 48 + x) * 4 + 3) as usize] == 0) {
                let mut small = Vec::with_capacity(32 * 32 * 4);
                for y in 0..32u32 {
                    let start = ((y * 48) * 4) as usize;
                    small.extend_from_slice(&px[start..start + 32 * 4]);
                }
                px = small;
                w = 32;
                h = 32;
            }
        }
        Some((w, h, px))
    }

    fn encode(w: u32, h: u32, px: &[u8]) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().ok()?;
            writer.write_image_data(px).ok()?;
        }
        Some(out)
    }

    /// HICON -> PNG, lalu ikonnya dihancurin.
    unsafe fn take(icon: HICON) -> Option<Vec<u8>> {
        if icon.is_invalid() {
            return None;
        }
        let rgba = unsafe { to_rgba(icon) };
        let _ = unsafe { DestroyIcon(icon) };
        let (w, h, px) = rgba?;
        // Ikon yang semua pikselnya tembus pandang = gagal dibaca.
        if px.chunks_exact(4).all(|p| p[3] == 0) {
            return None;
        }
        encode(w, h, &px)
    }

    /// Langsung dari file exe/dll/ico, ukuran 48px (paling tajem buat app).
    unsafe fn from_resource(wide: &[u16]) -> Option<Vec<u8>> {
        if wide.len() > 260 {
            return None;
        }
        let mut name = [0u16; 260];
        name[..wide.len()].copy_from_slice(wide);
        let mut icons = [HICON::default()];
        let n = unsafe { PrivateExtractIconsW(&name, 0, 48, 48, Some(&mut icons), None, 0) };
        if n == 0 || n == u32::MAX {
            return None;
        }
        unsafe { take(icons[0]) }
    }

    /// Ikon versi Explorer (48px), termasuk folder, shortcut, dan file biasa.
    unsafe fn from_image_list(wide: &[u16]) -> Option<Vec<u8>> {
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info),
                size_of::<SHFILEINFOW>() as u32,
                SHGFI_SYSICONINDEX,
            )
        };
        if ok == 0 {
            return None;
        }
        let list: IImageList = unsafe { SHGetImageList(SHIL_EXTRALARGE as i32) }.ok()?;
        let icon = unsafe { list.GetIcon(info.iIcon, ILD_TRANSPARENT.0) }.ok()?;
        unsafe { take(icon) }
    }

    /// Cadangan terakhir: ikon 32px biasa dari Explorer.
    unsafe fn from_file_info(wide: &[u16]) -> Option<Vec<u8>> {
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info),
                size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            )
        };
        if ok == 0 {
            return None;
        }
        unsafe { take(info.hIcon) }
    }

    fn extract(path: &str) -> Option<Vec<u8>> {
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let lower = path.to_ascii_lowercase();
        let resource = [".exe", ".dll", ".ico"].iter().any(|e| lower.ends_with(e));
        unsafe {
            if resource && let Some(png) = from_resource(&wide) {
                return Some(png);
            }
            if let Some(png) = from_image_list(&wide) {
                return Some(png);
            }
            from_file_info(&wide)
        }
    }

    /// Ikon shell butuh COM mode STA. Thread bawaan Tokio bisa aja udah
    /// kepakai mode MTA (kontrol media, mic), jadi tiap ambil ikon dibikinin
    /// thread baru sendiri.
    pub fn icon_png(path: &str) -> Option<Vec<u8>> {
        let path = path.to_string();
        let handle = std::thread::spawn(move || {
            let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            let png = extract(&path);
            if init.is_ok() {
                unsafe { CoUninitialize() };
            }
            if png.is_none() {
                eprintln!("[pointify] ikon nggak kebaca: {path}");
            }
            png
        });
        handle.join().ok().flatten()
    }
}

#[cfg(not(windows))]
mod shell {
    pub fn icon_png(_path: &str) -> Option<Vec<u8>> {
        None
    }
}
