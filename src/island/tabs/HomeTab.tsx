import { useRef } from "react";
import { Icon } from "../../components/Icon";
import { Pip, type PipMood } from "../../components/Pip";
import { Ring } from "../../components/Ring";
import { api } from "../../lib/api";
import { appName, greeting, mmss } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { useStore } from "../../lib/store";
import { setTab } from "../../state/island";
import { activeLyricIndex, lyricsStore, mediaStore, positionAt, trackKey } from "../../state/media";
import { settingsStore } from "../../state/settings";
import { PHASE_LABEL, pauseTimer, phaseDuration, remaining, startTimer, timerStore } from "../../state/timer";
import { drink, undoDrink, waterStore } from "../../state/water";

export function HomeTab({ mood }: { mood: PipMood }) {
  return (
    <div className="home">
      <MusicCard mood={mood} />
      <div className="home-side">
        <TimerMini />
        <WaterMini />
      </div>
    </div>
  );
}

function MusicCard({ mood }: { mood: PipMood }) {
  const media = useStore(mediaStore);
  const lyrics = useStore(lyricsStore);
  const settings = useStore(settingsStore);
  const now = useNow(250, !!media?.isPlaying);
  const barRef = useRef<HTMLDivElement>(null);

  if (!media) {
    return (
      <section className="card music empty">
        <Pip mood={mood} size={64} glow interactive />
        <div>
          <strong className="music-greet">{greeting()}</strong>
          <p className="muted">Puter lagu di Spotify atau YouTube, nanti lagunya muncul di sini lengkap sama liriknya.</p>
        </div>
      </section>
    );
  }

  const pos = positionAt(media, now);
  const progress = media.durationMs > 0 ? pos / media.durationMs : 0;
  const lyricsReady = lyrics.key === trackKey(media) && lyrics.status === "ready";
  const idx = lyricsReady ? activeLyricIndex(lyrics.lines, pos + (settings?.lyricOffsetMs ?? 0)) : -1;
  const current = lyricsReady ? (idx >= 0 ? lyrics.lines[idx].text || "♪" : "♪") : null;
  const next = lyricsReady ? lyrics.lines[idx + 1]?.text ?? "" : "";

  const seek = (clientX: number) => {
    const el = barRef.current;
    if (!el || media.durationMs <= 0) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    void api.mediaSeek(ratio * media.durationMs);
  };

  return (
    <section className="card music">
      {media.thumbnail && <div className="music-backdrop" style={{ backgroundImage: `url(${media.thumbnail})` }} />}
      <div className="music-top">
        {media.thumbnail ? <img className="cover" src={media.thumbnail} alt="" /> : <div className="cover cover-empty"><Icon name="music" size={22} /></div>}
        <div className="music-meta">
          <strong className="ellipsis">{media.title}</strong>
          <span className="muted ellipsis">
            {media.artist || "Tanpa artis"} · {appName(media.appId)}
          </span>
        </div>
        <div className="music-controls">
          <button className="icon-btn" aria-label="Sebelumnya" onClick={() => void api.mediaControl("prev")}>
            <Icon name="prev" size={18} />
          </button>
          <button className="play-btn" aria-label={media.isPlaying ? "Jeda" : "Putar"} onClick={() => void api.mediaControl("toggle")}>
            <Icon name={media.isPlaying ? "pause" : "play"} size={18} />
          </button>
          <button className="icon-btn" aria-label="Berikutnya" onClick={() => void api.mediaControl("next")}>
            <Icon name="next" size={18} />
          </button>
        </div>
      </div>

      {media.durationMs > 0 && (
        <div className="progress-row">
          <span className="tabular muted">{mmss(pos)}</span>
          <div
            ref={barRef}
            className="progress"
            role="slider"
            aria-label="Posisi lagu"
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

      {settings?.showLyrics !== false && (
        <div className="lyrics">
          {current !== null ? (
            <>
              <div key={idx} className="lyric-now ellipsis">
                {current}
              </div>
              <div className="lyric-next ellipsis">{next}</div>
            </>
          ) : (
            <div className="lyric-status muted">
              {lyrics.status === "loading" ? "Nyari lirik…" : "Lirik lagu ini belum ketemu."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TimerMini() {
  const timer = useStore(timerStore);
  const now = useNow(1000, timer.running);
  const left = remaining(timer, now);
  const total = phaseDuration(timer.phase);
  return (
    <section className="card mini" onClick={() => setTab("timer")} role="button" aria-label="Buka timer fokus">
      <Ring size={44} stroke={4} progress={1 - left / total} color={timer.phase === "focus" ? "var(--accent)" : "var(--green)"}>
        <Icon name="timer" size={16} />
      </Ring>
      <div className="mini-text">
        <strong className="tabular">{mmss(left)}</strong>
        <span className="muted">{PHASE_LABEL[timer.phase]}</span>
      </div>
      <button
        className="icon-btn solid"
        aria-label={timer.running ? "Jeda timer" : "Mulai timer"}
        onClick={(e) => {
          e.stopPropagation();
          if (timer.running) pauseTimer();
          else startTimer();
        }}
      >
        <Icon name={timer.running ? "pause" : "play"} size={15} />
      </button>
    </section>
  );
}

function WaterMini() {
  const water = useStore(waterStore);
  const settings = useStore(settingsStore);
  const now = useNow(30_000);
  const goal = settings?.waterGoal ?? 8;
  const minutesLeft = Math.max(0, Math.round((water.nextAt - now) / 60_000));
  return (
    <section className="card mini water">
      <div className="water-glasses" aria-label={`${water.count} dari ${goal} gelas`}>
        {Array.from({ length: Math.min(goal, 12) }, (_, i) => (
          <span key={i} className={i < water.count ? "glass full" : "glass"} />
        ))}
      </div>
      <div className="mini-text">
        <strong>
          {water.count}/{goal} gelas
        </strong>
        <span className="muted">
          {!settings?.waterEnabled ? "Pengingat mati" : water.count >= goal ? "Target tercapai" : `${minutesLeft} mnt lagi`}
        </span>
      </div>
      <div className="water-buttons">
        <button className="icon-btn" aria-label="Kurangi satu gelas" onClick={undoDrink} disabled={water.count === 0}>
          <Icon name="minus" size={14} />
        </button>
        <button className="icon-btn solid water-add" aria-label="Tambah satu gelas" onClick={drink}>
          <Icon name="drop" size={15} />
        </button>
      </div>
    </section>
  );
}
