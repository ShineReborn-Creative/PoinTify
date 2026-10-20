import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type MediaInfo = {
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  appId: string;
  thumbnail: string | null;
  positionMs: number;
  positionAtMs: number;
  durationMs: number;
};

type LyricLine = { timeMs: number; text: string };

type LyricsState =
  | { key: string; status: "loading" }
  | { key: string; status: "none" }
  | { key: string; status: "ready"; lines: LyricLine[] };

// Geser kalau lirik kerasa telat (+) atau kecepetan (-)
const LYRIC_OFFSET_MS = 0;

const ICONS = {
  prev: "M6 6h2v12H6zM9.5 12 18 18V6z",
  next: "M16 6h2v12h-2zM6 18l8.5-6L6 6z",
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d={d} />
    </svg>
  );
}

function activeIndex(lines: LyricLine[], positionMs: number) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) idx = i;
    else break;
  }
  return idx;
}

function Lyrics({ state, positionMs }: { state: LyricsState; positionMs: number }) {
  if (state.status === "loading") {
    return <div className="lyrics muted">Nyari lirik...</div>;
  }
  if (state.status === "none") {
    return <div className="lyrics muted">Lirik nggak ketemu</div>;
  }
  const i = activeIndex(state.lines, positionMs + LYRIC_OFFSET_MS);
  const current = i >= 0 ? state.lines[i].text || "♪" : "♪";
  const next = state.lines[i + 1]?.text ?? "";
  return (
    <div className="lyrics">
      <div key={i} className="lyric-current">{current}</div>
      <div className="lyric-next">{next}</div>
    </div>
  );
}

function App() {
  const [expanded, setExpanded] = useState(false);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [lyrics, setLyrics] = useState<LyricsState>({ key: "", status: "none" });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    invoke<MediaInfo | null>("media_get").then(setMedia);
    const offHover = listen<boolean>("notch-hover", (e) => setExpanded(e.payload));
    const offMedia = listen<MediaInfo | null>("media-update", (e) => setMedia(e.payload));
    return () => {
      offHover.then((stop) => stop());
      offMedia.then((stop) => stop());
    };
  }, []);

  // Ambil lirik tiap lagunya ganti
  const trackKey = media ? `${media.title}|${media.artist}` : "";
  useEffect(() => {
    if (!media || !media.title) return;
    const key = trackKey;
    let cancelled = false;
    setLyrics({ key, status: "loading" });
    invoke<LyricLine[] | null>("lyrics_fetch", {
      title: media.title,
      artist: media.artist,
      album: media.album,
      durationMs: media.durationMs,
    })
      .then((lines) => {
        if (cancelled) return;
        setLyrics(lines ? { key, status: "ready", lines } : { key, status: "none" });
      })
      .catch(() => {
        if (!cancelled) setLyrics({ key, status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [trackKey]);

  // "Jam" buat ngitung posisi lagu sekarang
  useEffect(() => {
    if (!media?.isPlaying) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [media?.isPlaying]);

  const positionMs = !media
    ? 0
    : media.isPlaying && media.positionAtMs > 0
      ? media.positionMs + Math.max(0, now - media.positionAtMs)
      : media.positionMs;

  const control = (action: "prev" | "toggle" | "next") =>
    invoke("media_control", { action });

  const lyricsForTrack: LyricsState =
    lyrics.key === trackKey ? lyrics : { key: trackKey, status: "loading" };

  return (
    <div className="stage">
      <div className={`notch ${expanded ? "expanded" : ""}`}>
        {!expanded && media && (
          <div className="mini">
            {media.thumbnail && <img className="mini-art" src={media.thumbnail} alt="" />}
            <div className={`bars ${media.isPlaying ? "playing" : ""}`}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {expanded && (
          <div className="content">
            {media ? (
              <>
                <div className="player">
                  {media.thumbnail ? (
                    <img className="art" src={media.thumbnail} alt="" />
                  ) : (
                    <div className="art" />
                  )}
                  <div className="meta">
                    <div className="title">{media.title || "Tanpa judul"}</div>
                    <div className="artist">{media.artist}</div>
                    <div className="controls">
                      <button onClick={() => control("prev")} aria-label="Sebelumnya">
                        <Icon d={ICONS.prev} />
                      </button>
                      <button onClick={() => control("toggle")} aria-label="Play/Pause">
                        <Icon d={media.isPlaying ? ICONS.pause : ICONS.play} />
                      </button>
                      <button onClick={() => control("next")} aria-label="Berikutnya">
                        <Icon d={ICONS.next} />
                      </button>
                    </div>
                  </div>
                </div>
                <Lyrics state={lyricsForTrack} positionMs={positionMs} />
              </>
            ) : (
              <div className="empty">Nggak ada musik yang lagi diputer</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;