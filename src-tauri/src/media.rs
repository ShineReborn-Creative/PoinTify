//! Musik: baca lagu yang lagi diputer dari kontrol media bawaan Windows
//! (SMTC), dipakai Spotify, browser, dan app musik lain.

// Penebak lagu/video cuma dipanggil di Windows (di luar itu cuma dites).
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    pub app_id: String,
    pub thumbnail: Option<String>,
    pub position_ms: u64,
    pub position_at_ms: u64,
    pub duration_ms: u64,
    /// "music" atau "video" (film, series, YouTube biasa). Dipakai biar Pip
    /// ikut nonton pakai kacamata + popcorn, bukan joget.
    pub kind: &'static str,
}

#[derive(Default)]
pub struct MediaState(pub Mutex<Option<MediaInfo>>);

#[tauri::command]
pub fn media_get(state: State<MediaState>) -> Option<MediaInfo> {
    state.0.lock().unwrap().clone()
}

#[cfg(not(windows))]
use fallback as platform;
#[cfg(windows)]
use imp as platform;

pub use platform::start_watcher;

const BROWSERS: &[&str] = &["chrome", "msedge", "firefox", "opera", "brave", "vivaldi", "arc", "zen", "yandex", "browser"];
const VIDEO_APPS: &[&str] = &[
    "vlc",
    "mpc-hc",
    "mpc-be",
    "potplayer",
    "mpv",
    "kmplayer",
    "gom",
    "zunevideo",
    "netflix",
    "disney",
    "primevideo",
    "amazon video",
    "plex",
    "stremio",
    "jellyfin",
    "kodi",
    "iqiyi",
    "viu",
    "vidio",
    "wetv",
    "hotstar",
    "hbo",
    "crunchyroll",
    "twitch",
];
const MUSIC_APPS: &[&str] = &[
    "spotify",
    "applemusic",
    "apple music",
    "deezer",
    "tidal",
    "youtube music",
    "foobar",
    "musicbee",
    "aimp",
    "winamp",
    "joox",
    "resso",
    "soundcloud",
];
const VIDEO_WORDS: &[&str] = &[
    "episode",
    "episod",
    "eps ",
    "eps.",
    " ep ",
    " ep.",
    "season",
    "trailer",
    "full movie",
    "movie",
    "film",
    "netflix",
    "prime video",
    "disney+",
    "sub indo",
    "subtitle",
    "nonton",
    "anime",
    "drama",
    "vlog",
    "podcast",
    "| vidio",
    "crunchyroll",
];
const MUSIC_WORDS: &[&str] = &[
    "official music video",
    "music video",
    "official video",
    "official audio",
    "lyric",
    "lirik",
    "(audio)",
    "[audio]",
    " mv",
    "(mv)",
    "[mv]",
    "live performance",
    "cover",
    "remix",
    "acoustic",
    "karaoke",
];

/// Tebak yang diputer itu lagu atau tontonan. `video_hint`: app-nya sendiri
/// bilang video ke Windows (browser selalu ngaku "musik", jadi diabaikan).
pub(crate) fn classify(app_id: &str, title: &str, artist: &str, duration_ms: u64, video_hint: Option<bool>) -> &'static str {
    let app = app_id.to_lowercase();
    let title_l = format!(" {} ", title.to_lowercase());
    let has = |list: &[&str], hay: &str| list.iter().any(|w| hay.contains(w));

    if has(VIDEO_APPS, &app) {
        return "video";
    }
    if has(MUSIC_APPS, &app) {
        return if video_hint == Some(true) { "video" } else { "music" };
    }
    if !has(BROWSERS, &app) {
        return if video_hint == Some(true) { "video" } else { "music" };
    }

    // Browser: tebak dari judul, artis (nama channel), dan durasi.
    if has(MUSIC_WORDS, &title_l) || artist.trim_end().to_lowercase().ends_with("- topic") {
        return "music";
    }
    if has(VIDEO_WORDS, &title_l) || episode_code(&title_l) {
        return "video";
    }
    if artist.trim().is_empty() || duration_ms >= 20 * 60_000 {
        return "video";
    }
    "music"
}

/// Kode episode kayak "S2E22", "s01e05", atau "2x05".
fn episode_code(title: &str) -> bool {
    let b = title.as_bytes();
    (0..b.len()).any(|i| {
        let digits = |from: usize| b[from..].iter().take_while(|c| c.is_ascii_digit()).count();
        if b[i] == b's' && (i == 0 || !b[i - 1].is_ascii_alphabetic()) {
            let n = digits(i + 1);
            n > 0 && b.get(i + 1 + n) == Some(&b'e') && digits(i + 2 + n) > 0
        } else if b[i].is_ascii_digit() && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let n = digits(i);
            n <= 2 && b.get(i + n) == Some(&b'x') && (1..=3).contains(&digits(i + n + 1))
        } else {
            false
        }
    })
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn tebak_jenis_media() {
        let chrome = "Chrome";
        assert_eq!(classify(chrome, "The Mentalist S2E22: Red Letters", "", 2_563_000, Some(false)), "video");
        assert_eq!(classify(chrome, "Hindia - Evaluasi (Official Music Video)", "Hindia", 240_000, None), "music");
        assert_eq!(classify(chrome, "Evaluasi", "Hindia - Topic", 240_000, None), "music");
        assert_eq!(classify(chrome, "Ngoding seharian", "Windah Basudara", 3_600_000, None), "video");
        assert_eq!(classify(chrome, "Bohemian Rhapsody", "Queen Official", 360_000, None), "music");
        assert_eq!(classify("Spotify.exe", "Podcast Seru", "Someone", 3_600_000, None), "music");
        assert_eq!(classify("VideoLAN.VLC", "movie.mkv", "", 0, None), "video");
        assert_eq!(classify("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "clip", "", 0, Some(true)), "video");
        assert_eq!(classify(chrome, "Lagu Santai 2x05 remix", "DJ", 200_000, None), "music");
        assert_eq!(classify(chrome, "Friends 2x05", "Channel", 1_300_000, None), "video");
    }
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::control(&action)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_seek(position_ms: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || platform::seek(position_ms)).await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod imp {
    use super::{MediaInfo, MediaState};
    use base64::{Engine, engine::general_purpose::STANDARD};
    use std::{thread, time::Duration};
    use tauri::{AppHandle, Emitter, Manager};
    use windows::{
        Media::Control::{
            GlobalSystemMediaTransportControlsSessionManager as SessionManager,
            GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        },
        Media::MediaPlaybackType,
        Storage::Streams::DataReader,
    };

    /// Selisih epoch Windows (1601) ke Unix (1970), dalam satuan 100 ns.
    const WINDOWS_TO_UNIX: i64 = 116_444_736_000_000_000;

    fn read_thumbnail(props: &MediaProperties) -> Option<String> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        reader.LoadAsync(size).ok()?.join().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;

        let mime = stream.ContentType().map(|c| c.to_string()).unwrap_or_default();
        let mime = if mime.is_empty() { "image/png".to_string() } else { mime };
        Some(format!("data:{mime};base64,{}", STANDARD.encode(&buf)))
    }

    fn snapshot(manager: &SessionManager, track_key: &mut String, thumbnail: &mut Option<String>) -> Option<MediaInfo> {
        let session = manager.GetCurrentSession().ok()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.trim().is_empty() {
            return None;
        }
        let artist = props.Artist().ok()?.to_string();
        let album = props.AlbumTitle().map(|a| a.to_string()).unwrap_or_default();
        let playback = session.GetPlaybackInfo().ok()?;
        let is_playing = playback.PlaybackStatus().ok()? == PlaybackStatus::Playing;
        let video_hint = playback.PlaybackType().ok().and_then(|t| t.Value().ok()).map(|t| t == MediaPlaybackType::Video);
        let app_id = session.SourceAppUserModelId().ok()?.to_string();

        let (position_ms, duration_ms, position_at_ms) = session
            .GetTimelineProperties()
            .ok()
            .and_then(|t| {
                let pos = t.Position().ok()?.Duration / 10_000;
                let end = t.EndTime().ok()?.Duration / 10_000;
                let updated = (t.LastUpdatedTime().ok()?.UniversalTime - WINDOWS_TO_UNIX) / 10_000;
                Some((pos.max(0) as u64, end.max(0) as u64, updated.max(0) as u64))
            })
            .unwrap_or((0, 0, 0));

        // Cover cuma dibaca ulang kalau lagunya ganti (atau belum dapet cover).
        let key = format!("{title}|{artist}");
        if key != *track_key || thumbnail.is_none() {
            *track_key = key;
            *thumbnail = read_thumbnail(&props);
        }

        let kind = super::classify(&app_id, &title, &artist, duration_ms, video_hint);
        Some(MediaInfo {
            title,
            artist,
            album,
            is_playing,
            app_id,
            thumbnail: thumbnail.clone(),
            position_ms,
            position_at_ms,
            duration_ms,
            kind,
        })
    }

    pub fn start_watcher(app: AppHandle) {
        thread::spawn(move || {
            let Ok(manager) = SessionManager::RequestAsync().and_then(|op| op.join()) else {
                eprintln!("[pointify] kontrol media Windows nggak bisa diakses");
                return;
            };
            let mut last: Option<MediaInfo> = None;
            let mut track_key = String::new();
            let mut thumbnail: Option<String> = None;

            loop {
                let current = snapshot(&manager, &mut track_key, &mut thumbnail);
                if current != last {
                    *app.state::<MediaState>().0.lock().unwrap() = current.clone();
                    let _ = app.emit("media-update", &current);
                    last = current;
                }
                // Lebih jarang ngecek kalau nggak ada yang diputer.
                let idle = last.as_ref().map(|m| !m.is_playing).unwrap_or(true);
                thread::sleep(Duration::from_millis(if idle { 1500 } else { 700 }));
            }
        });
    }

    fn with_session<F>(f: F) -> Result<(), String>
    where
        F: FnOnce(windows::Media::Control::GlobalSystemMediaTransportControlsSession) -> windows::core::Result<()>,
    {
        let session =
            SessionManager::RequestAsync().and_then(|op| op.join()).and_then(|m| m.GetCurrentSession()).map_err(|e| e.to_string())?;
        f(session).map_err(|e| e.to_string())
    }

    pub fn control(action: &str) -> Result<(), String> {
        with_session(|s| {
            match action {
                "toggle" => {
                    s.TryTogglePlayPauseAsync()?.join()?;
                }
                "next" => {
                    s.TrySkipNextAsync()?.join()?;
                }
                "prev" => {
                    s.TrySkipPreviousAsync()?.join()?;
                }
                _ => {}
            }
            Ok(())
        })
    }

    pub fn seek(position_ms: u64) -> Result<(), String> {
        with_session(|s| {
            s.TryChangePlaybackPositionAsync(position_ms as i64 * 10_000)?.join()?;
            Ok(())
        })
    }
}

#[cfg(not(windows))]
mod fallback {
    use tauri::AppHandle;

    pub fn start_watcher(_app: AppHandle) {}

    pub fn control(_action: &str) -> Result<(), String> {
        Err("Kontrol media cuma ada di Windows".into())
    }

    pub fn seek(_position_ms: u64) -> Result<(), String> {
        Err("Kontrol media cuma ada di Windows".into())
    }
}
