import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Pip, type PipMood } from "../../components/Pip";
import { api } from "../../lib/api";
import { appName, mmss } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { useStore } from "../../lib/store";
import { activeLyricIndex, lyricsStore, mediaStore, positionAt, trackKey } from "../../state/media";
import { settingsStore } from "../../state/settings";
import { tr } from "../../i18n";

/**
 * Tab Musik: cuma nongol pas ada lagu. Cover gede, kontrol, dan lirik sinkron
 * yang jalan kayak karaoke. Klik baris lirik buat lompat ke situ.
 */
export function MusicTab({ mood }: { mood: PipMood }) {
  const media = useStore(mediaStore);
  const lyrics = useStore(lyricsStore);
  const settings = useStore(settingsStore);
  const now = useNow(200, !!media?.isPlaying);
  const barRef = useRef<HTMLDivElement>(null);

  if (!media) {
    return (
      <div className="music-tab empty">
        <Pip mood={mood} size={56} glow />
        <div>
          <strong>{tr("Lagunya udah berhenti", "Nothing's playing")}</strong>
          <p className="muted">{tr("Puter lagi di Spotify atau YouTube, nanti liriknya jalan di sini.", "Play something on Spotify or YouTube and the lyrics will roll here.")}</p>
        </div>
      </div>
    );
  }

  const offset = settings?.lyricOffsetMs ?? 0;
  const pos = positionAt(media, now);
  const progress = media.durationMs > 0 ? pos / media.durationMs : 0;
  const ready = lyrics.key === trackKey(media) && lyrics.status === "ready" && lyrics.lines.length > 0;
  const idx = ready ? activeLyricIndex(lyrics.lines, pos + offset) : -1;
  const showLyrics = media.kind !== "video" && settings?.showLyrics !== false;

  const seek = (clientX: number) => {
    const el = barRef.current;
    if (!el || media.durationMs <= 0) return;
    const r = el.getBoundingClientRect();
    void api.mediaSeek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * media.durationMs);
  };

  return (
    <div className="music-tab">
      {media.thumbnail && <div className="music-backdrop" style={{ backgroundImage: `url(${media.thumbnail})` }} />}
      <div className="music-tab-side">
        {media.thumbnail ? (
          <img className="music-tab-cover" src={media.thumbnail} alt="" />
        ) : (
          <div className="music-tab-cover cover-empty">
            <Icon name="music" size={34} />
          </div>
        )}
        <div className="music-controls">
          <button className="icon-btn" aria-label={tr("Sebelumnya", "Previous")} onClick={() => void api.mediaControl("prev")}>
            <Icon name="prev" size={18} />
          </button>
          <button className="play-btn" aria-label={media.isPlaying ? tr("Jeda", "Pause") : tr("Putar", "Play")} onClick={() => void api.mediaControl("toggle")}>
            <Icon name={media.isPlaying ? "pause" : "play"} size={18} />
          </button>
          <button className="icon-btn" aria-label={tr("Berikutnya", "Next")} onClick={() => void api.mediaControl("next")}>
            <Icon name="next" size={18} />
          </button>
        </div>
      </div>

      <div className="music-tab-main">
        <div className="music-tab-meta">
          <strong className="ellipsis" title={media.title}>
            {media.title}
          </strong>
          <span className="muted ellipsis">{media.artist ? `${media.artist} · ${appName(media.appId)}` : appName(media.appId)}</span>
        </div>

        {showLyrics ? (
          ready ? (
            <Karaoke lines={lyrics.lines} idx={idx} onPick={(ms) => void api.mediaSeek(Math.max(0, ms - offset))} />
          ) : (
            <div className="music-tab-status muted">
              {lyrics.status === "loading" ? tr("Nyari lirik…", "Finding lyrics…") : tr("Lirik lagu ini belum ketemu.", "No lyrics found for this song.")}
            </div>
          )
        ) : (
          <div className="music-tab-status muted">
            {media.kind === "video" ? tr("Lagi nonton. Pip udah siap popcorn 🍿", "Watching something. Pip has the popcorn ready 🍿") : tr("Lirik dimatiin di Pengaturan.", "Lyrics are turned off in Settings.")}
          </div>
        )}

        {media.durationMs > 0 && (
          <div className="progress-row">
            <span className="tabular muted">{mmss(pos)}</span>
            <div
              ref={barRef}
              className="progress"
              role="slider"
              aria-label={tr("Posisi lagu", "Song position")}
              aria-valuemin={0}
              aria-valuemax={Math.round(media.durationMs / 1000)}
              aria-valuenow={Math.round(pos / 1000)}
              onClick={(e) => seek(e.clientX)}
            >
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="tabular muted">{mmss(media.durationMs)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Semua baris lirik; baris yang lagi dinyanyiin digeser ke sepertiga atas. */
function Karaoke({ lines, idx, onPick }: { lines: { timeMs: number; text: string }[]; idx: number; onPick: (ms: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>(`[data-i="${Math.max(0, idx)}"]`);
    if (!el || !line) return;
    setShift(Math.max(0, line.offsetTop - el.clientHeight * 0.32));
  }, [idx, lines]);
  return (
    <div className="karaoke" ref={box}>
      <div className="karaoke-track" style={{ transform: `translateY(${-shift}px)` }}>
        {lines.map((l, i) => (
          <button
            key={i}
            data-i={i}
            className={`karaoke-line${i === idx ? " now" : i < idx ? " past" : ""}`}
            onClick={() => onPick(l.timeMs)}
            title={tr(`Lompat ke ${mmss(l.timeMs)}`, `Jump to ${mmss(l.timeMs)}`)}
          >
            {l.text || "♪"}
          </button>
        ))}
      </div>
    </div>
  );
}
