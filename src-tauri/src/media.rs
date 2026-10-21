//! Musik: baca lagu yang lagi diputer dari kontrol media bawaan Windows
//! (SMTC), dipakai Spotify, browser, dan app musik lain.

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
        let is_playing = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? == PlaybackStatus::Playing;
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

        Some(MediaInfo { title, artist, album, is_playing, app_id, thumbnail: thumbnail.clone(), position_ms, position_at_ms, duration_ms })
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
