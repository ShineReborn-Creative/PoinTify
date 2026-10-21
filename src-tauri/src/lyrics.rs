//! Lirik sinkron dari LRCLIB. Request dilakukan dari Rust biar bisa pasang
//! User-Agent dan nggak kena urusan CORS. Hasil disimpan di memori supaya
//! lagu yang sama nggak dicari berkali-kali.

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::State;

const API: &str = "https://lrclib.net/api";
const USER_AGENT: &str = concat!("PoinTify/", env!("CARGO_PKG_VERSION"));

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub time_ms: u64,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibTrack {
    synced_lyrics: Option<String>,
}

#[derive(Default)]
pub struct LyricsCache(pub Mutex<HashMap<String, Option<Vec<LyricLine>>>>);

/// "01:23.45" -> 83450 ms
fn parse_time(tag: &str) -> Option<u64> {
    let (min, sec) = tag.split_once(':')?;
    let min: u64 = min.trim().parse().ok()?;
    let sec: f64 = sec.trim().parse().ok()?;
    Some(min * 60_000 + (sec * 1000.0).round() as u64)
}

fn parse_lrc(lrc: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();
    for raw in lrc.lines() {
        let mut rest = raw.trim();
        let mut times = Vec::new();
        // Satu baris bisa punya beberapa tag waktu: [00:12.00][01:30.00] teks
        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(end) = stripped.find(']') else { break };
            match parse_time(&stripped[..end]) {
                Some(ms) => times.push(ms),
                None => break,
            }
            rest = &stripped[end + 1..];
        }
        let text = rest.trim().to_string();
        for time_ms in times {
            lines.push(LyricLine { time_ms, text: text.clone() });
        }
    }
    lines.sort_by_key(|l| l.time_ms);
    lines
}

fn first_synced(tracks: Vec<LrcLibTrack>) -> Option<String> {
    tracks.into_iter().find_map(|t| t.synced_lyrics.filter(|s| !s.trim().is_empty()))
}

/// Judul video YouTube sering kayak "Artis - Judul (Official Video)".
/// Buang bagian dalam kurung biar pencarian lebih kena.
fn clean_title(title: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn fetch_synced(client: &reqwest::Client, title: &str, artist: &str, album: &str, duration_secs: Option<u64>) -> Option<String> {
    // 1. Pencocokan persis (judul + artis + album + durasi)
    let mut exact = vec![("track_name", title.to_string()), ("artist_name", artist.to_string())];
    if !album.is_empty() {
        exact.push(("album_name", album.to_string()));
    }
    if let Some(d) = duration_secs {
        exact.push(("duration", d.to_string()));
    }
    if let Ok(res) = client.get(format!("{API}/get")).query(&exact).send().await
        && res.status().is_success()
        && let Ok(track) = res.json::<LrcLibTrack>().await
        && let Some(s) = first_synced(vec![track])
    {
        return Some(s);
    }

    // 2. Pencarian judul + artis
    let by_fields = [("track_name", title), ("artist_name", artist)];
    if let Ok(res) = client.get(format!("{API}/search")).query(&by_fields).send().await
        && let Ok(list) = res.json::<Vec<LrcLibTrack>>().await
        && let Some(s) = first_synced(list)
    {
        return Some(s);
    }

    // 3. Pencarian bebas pakai judul yang udah dibersihin
    let q = format!("{artist} {}", clean_title(title));
    let res = client.get(format!("{API}/search")).query(&[("q", q)]).send().await.ok()?;
    first_synced(res.json::<Vec<LrcLibTrack>>().await.ok()?)
}

#[tauri::command]
pub async fn lyrics_fetch(
    cache: State<'_, LyricsCache>,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
) -> Result<Option<Vec<LyricLine>>, String> {
    let key = format!("{}|{}", title.to_lowercase(), artist.to_lowercase());
    if let Some(hit) = cache.0.lock().unwrap().get(&key) {
        return Ok(hit.clone());
    }

    let client =
        reqwest::Client::builder().user_agent(USER_AGENT).timeout(std::time::Duration::from_secs(12)).build().map_err(|e| e.to_string())?;
    let duration_secs = (duration_ms > 0).then(|| (duration_ms + 500) / 1000);
    let lines = fetch_synced(&client, &title, &artist, &album, duration_secs).await.map(|lrc| parse_lrc(&lrc)).filter(|l| !l.is_empty());

    // Cuma simpan yang ketemu: kalau gagal karena koneksi, lain kali dicoba lagi.
    if lines.is_some() {
        cache.0.lock().unwrap().insert(key, lines.clone());
    }
    Ok(lines)
}
