use serde::{Deserialize, Serialize};

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

// "01:23.45" -> 83450 ms
fn parse_time(tag: &str) -> Option<u64> {
    let (min, sec) = tag.split_once(':')?;
    let min: u64 = min.parse().ok()?;
    let sec: f64 = sec.parse().ok()?;
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
    tracks
        .into_iter()
        .find_map(|t| t.synced_lyrics.filter(|s| !s.trim().is_empty()))
}

async fn fetch_synced(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    album: &str,
    duration_secs: Option<u64>,
) -> Option<String> {
    // 1. Pencocokan persis (judul + artis + album + durasi)
    let mut exact = vec![("track_name", title.to_string()), ("artist_name", artist.to_string())];
    if !album.is_empty() {
        exact.push(("album_name", album.to_string()));
    }
    if let Some(d) = duration_secs {
        exact.push(("duration", d.to_string()));
    }
    if let Ok(res) = client.get(format!("{API}/get")).query(&exact).send().await {
        if res.status().is_success() {
            if let Ok(track) = res.json::<LrcLibTrack>().await {
                if let Some(s) = first_synced(vec![track]) {
                    return Some(s);
                }
            }
        }
    }

    // 2. Pencarian berdasarkan judul + artis
    let by_fields = [("track_name", title), ("artist_name", artist)];
    if let Ok(res) = client.get(format!("{API}/search")).query(&by_fields).send().await {
        if let Ok(list) = res.json::<Vec<LrcLibTrack>>().await {
            if let Some(s) = first_synced(list) {
                return Some(s);
            }
        }
    }

    // 3. Pencarian bebas (buat judul video YouTube yang formatnya aneh-aneh)
    let q = format!("{artist} {title}");
    let res = client.get(format!("{API}/search")).query(&[("q", q)]).send().await.ok()?;
    first_synced(res.json::<Vec<LrcLibTrack>>().await.ok()?)
}

#[tauri::command]
pub async fn lyrics_fetch(
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
) -> Option<Vec<LyricLine>> {
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().ok()?;
    let duration_secs = (duration_ms > 0).then(|| (duration_ms + 500) / 1000);
    let lrc = fetch_synced(&client, &title, &artist, &album, duration_secs).await?;
    let lines = parse_lrc(&lrc);
    (!lines.is_empty()).then_some(lines)
}