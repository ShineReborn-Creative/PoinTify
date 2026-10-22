import { useRef } from "react";
import { Icon } from "../components/Icon";
import { Pip, type PipMood } from "../components/Pip";
import { api } from "../lib/api";
import { appName, greeting, mmss } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useStore } from "../lib/store";
import { activeLyricIndex, lyricsStore, mediaStore, positionAt, trackKey } from "../state/media";
import { dragPipOut } from "../state/pet";
import { settingsStore } from "../state/settings";
import { useClaimPip } from "../state/pipSpot";
import type { WidgetProps } from "./common";
import { tr } from "../i18n";
import { setTab } from "../state/island";

type Props = WidgetProps & { mood: PipMood };

export function MusicWidget({ size, mood }: Props) {
  const media = useStore(mediaStore);
  const lyrics = useStore(lyricsStore);
  const settings = useStore(settingsStore);
  const now = useNow(250, !!media?.isPlaying);
  const barRef = useRef<HTMLDivElement>(null);

  if (!media) {
    return <MusicEmpty size={size} mood={mood} />;
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

  const controls = (
    <div className="music-controls">
      <button className="icon-btn" aria-label={tr("Sebelumnya", "Previous")} onClick={() => void api.mediaControl("prev")}>
        <Icon name="prev" size={size === "w" ? 15 : 18} />
      </button>
      <button className="play-btn" aria-label={media.isPlaying ? tr("Jeda", "Pause") : tr("Putar", "Play")} onClick={() => void api.mediaControl("toggle")}>
        <Icon name={media.isPlaying ? "pause" : "play"} size={size === "w" ? 15 : 18} />
      </button>
      <button className="icon-btn" aria-label={tr("Berikutnya", "Next")} onClick={() => void api.mediaControl("next")}>
        <Icon name="next" size={size === "w" ? 15 : 18} />
      </button>
    </div>
  );

  if (size === "w") {
    return (
      <div className="w-music-w">
        {media.thumbnail && <div className="music-backdrop" style={{ backgroundImage: `url(${media.thumbnail})` }} />}
        <button className="cover-btn" title={tr("Buka tab Musik", "Open the Music tab")} aria-label={tr("Buka tab Musik", "Open the Music tab")} onClick={() => setTab("music")}>
          {media.thumbnail ? <img className="cover small" src={media.thumbnail} alt="" /> : <div className="cover small cover-empty"><Icon name="music" size={18} /></div>}
        </button>
        <div className="music-meta">
          <strong className="ellipsis">{media.title}</strong>
          <span className="muted ellipsis">{current ?? media.artist}</span>
        </div>
        {controls}
      </div>
    );
  }

  return (
    <div className={`music w-music size-${size}`}>
      {media.thumbnail && <div className="music-backdrop" style={{ backgroundImage: `url(${media.thumbnail})` }} />}
      <div className="music-top">
        <button className="cover-btn" title={tr("Buka tab Musik", "Open the Music tab")} aria-label={tr("Buka tab Musik", "Open the Music tab")} onClick={() => setTab("music")}>
          {media.thumbnail ? <img className="cover" src={media.thumbnail} alt="" /> : <div className="cover cover-empty"><Icon name="music" size={22} /></div>}
        </button>
        <div className="music-meta">
          <strong className="ellipsis">{media.title}</strong>
          <span className="muted ellipsis">
            {media.artist ? `${media.artist} · ${appName(media.appId)}` : appName(media.appId)}
          </span>
        </div>
        {size === "xl" && controls}
      </div>
      {media.durationMs > 0 && (
        <div className="progress-row">
          <span className="tabular muted">{mmss(pos)}</span>
          <div
            ref={barRef}
            className="progress"
            role="slider"
            aria-label={media.kind === "video" ? tr("Posisi video", "Video position") : tr("Posisi lagu", "Song position")}
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
      {size === "l" && <div className="w-music-l-controls">{controls}</div>}
      {media.kind === "video" ? (
        <div className="lyrics">
          <div className="lyric-status muted">{tr("Lagi nonton. Pip udah siap popcorn 🍿", "Watching something. Pip has the popcorn ready 🍿")}</div>
        </div>
      ) : settings?.showLyrics !== false && (
        <div className="lyrics">
          {current !== null ? (
            <>
              <div key={idx} className="lyric-now ellipsis">
                {current}
              </div>
              {size === "xl" && <div className="lyric-next ellipsis">{next}</div>}
            </>
          ) : (
            <div className="lyric-status muted">{lyrics.status === "loading" ? tr("Nyari lirik…", "Finding lyrics…") : tr("Lirik lagu ini belum ketemu.", "No lyrics found for this song.")}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Belum ada lagu: Pip yang nyapa (kecuali Pip-nya lagi main di desktop). */
function MusicEmpty({ size, mood }: { size: Props["size"]; mood: PipMood }) {
  const away = !!useStore(settingsStore)?.petMode;
  useClaimPip(!away);
  if (size === "w") {
    return (
      <div className="w-music-empty-w">
        {away ? <Icon name="music" size={18} /> : <Pip mood={mood} size={34} glow interactive onDragOut={dragPipOut} />}
        <div>
          <strong>{greeting()}</strong>
          <span className="muted">{tr("Puter lagu di Spotify atau YouTube", "Play something on Spotify or YouTube")}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`music empty w-music size-${size}`}>
      {away ? (
        <span className="w-pip-away-icon">
          <Icon name="music" size={24} />
        </span>
      ) : (
        <Pip mood={mood} size={size === "xl" ? 64 : 52} glow interactive onDragOut={dragPipOut} />
      )}
      <div>
        <strong className="music-greet">{greeting()}</strong>
        <p className="muted">{tr("Puter lagu di Spotify atau YouTube, nanti lagunya muncul di sini lengkap sama liriknya.", "Play something on Spotify or YouTube and it shows up here, lyrics included.")}</p>
      </div>
    </div>
  );
}

export function PipWidget({ size, mood }: Props) {
  const away = !!useStore(settingsStore)?.petMode;
  useClaimPip(!away);
  if (away) {
    return (
      <div className={`w-pip away size-${size}`}>
        <span className="muted">{tr("Pip lagi main di desktop", "Pip is out on the desktop")}</span>
        <button className="btn small" onClick={() => void api.petHome()}>
          {tr("Panggil balik", "Call back")}
        </button>
      </div>
    );
  }
  return (
    <div className={`w-pip size-${size}`}>
      <Pip mood={mood === "sleep" ? "idle" : mood} size={size === "s" ? 50 : 56} glow interactive onDragOut={dragPipOut} />
      {size !== "s" && (
        <div>
          <strong>{greeting()}</strong>
          <span className="muted">{tr("Klik, tahan, atau tarik gue ke bawah.", "Click me, hold me, or drag me down.")}</span>
        </div>
      )}
    </div>
  );
}
