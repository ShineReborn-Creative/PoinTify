import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type MediaInfo = {
  title: string;
  artist: string;
  isPlaying: boolean;
  appId: string;
  thumbnail: string | null;
};

const ICONS = {
  prev: "M6 6h2v12H6zM9.5 12 18 18V6z",
  next: "M16 6h2v12h-2zM6 18l8.5-6L6 6z",
  play: "M8 5v14l11-7z",
  pause: "M6 5h4v14H6zM14 5h4v14h-4z",
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
      <path d={d} />
    </svg>
  );
}

function App() {
  const [expanded, setExpanded] = useState(false);
  const [media, setMedia] = useState<MediaInfo | null>(null);

  useEffect(() => {
    invoke<MediaInfo | null>("media_get").then(setMedia);
    const offHover = listen<boolean>("notch-hover", (e) => setExpanded(e.payload));
    const offMedia = listen<MediaInfo | null>("media-update", (e) => setMedia(e.payload));
    return () => {
      offHover.then((stop) => stop());
      offMedia.then((stop) => stop());
    };
  }, []);

  const control = (action: "prev" | "toggle" | "next") =>
    invoke("media_control", { action });

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