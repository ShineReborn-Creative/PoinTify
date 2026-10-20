use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    },
    Storage::Streams::DataReader,
};

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
    pub app_id: String,
    pub thumbnail: Option<String>,
}

#[derive(Default)]
pub struct MediaState(pub Mutex<Option<MediaInfo>>);

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

fn snapshot(
    manager: &SessionManager,
    track_key: &mut String,
    thumbnail: &mut Option<String>,
) -> Option<MediaInfo> {
    let session = manager.GetCurrentSession().ok()?;
    let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let title = props.Title().ok()?.to_string();
    let artist = props.Artist().ok()?.to_string();
    let is_playing =
        session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? == PlaybackStatus::Playing;
    let app_id = session.SourceAppUserModelId().ok()?.to_string();

    // Cover cuma dibaca ulang kalau lagunya ganti (atau belum dapet cover)
    let key = format!("{title}|{artist}");
    if key != *track_key || thumbnail.is_none() {
        *track_key = key;
        *thumbnail = read_thumbnail(&props);
    }

    Some(MediaInfo { title, artist, is_playing, app_id, thumbnail: thumbnail.clone() })
}

pub fn start_watcher(app: AppHandle) {
    thread::spawn(move || {
        let Ok(manager) = SessionManager::RequestAsync().and_then(|op| op.join()) else {
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
            thread::sleep(Duration::from_millis(700));
        }
    });
}

#[tauri::command]
pub fn media_get(state: State<MediaState>) -> Option<MediaInfo> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<()> {
        let session = SessionManager::RequestAsync()?.join()?.GetCurrentSession()?;
        match action.as_str() {
            "toggle" => { session.TryTogglePlayPauseAsync()?.join()?; }
            "next" => { session.TrySkipNextAsync()?.join()?; }
            "prev" => { session.TrySkipPreviousAsync()?.join()?; }
            _ => {}
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}