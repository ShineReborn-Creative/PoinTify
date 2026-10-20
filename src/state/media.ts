import { listen } from "@tauri-apps/api/event";
import { api, type LyricLine, type MediaInfo } from "../lib/api";
import { createStore } from "../lib/store";
import { settingsStore } from "./settings";

export const mediaStore = createStore<MediaInfo | null>(null);

export type LyricsState = {
  key: string;
  status: "idle" | "loading" | "ready" | "none";
  lines: LyricLine[];
};

export const lyricsStore = createStore<LyricsState>({ key: "", status: "idle", lines: [] });

export function trackKey(m: MediaInfo | null): string {
  return m ? `${m.title}|${m.artist}` : "";
}

/** Posisi lagu sekarang: posisi terakhir dari Windows + waktu yang udah lewat. */
export function positionAt(m: MediaInfo | null, now: number): number {
  if (!m) return 0;
  let pos = m.positionMs;
  if (m.isPlaying && m.positionAtMs > 0) pos += Math.max(0, now - m.positionAtMs);
  return m.durationMs > 0 ? Math.min(pos, m.durationMs) : pos;
}

export function activeLyricIndex(lines: LyricLine[], positionMs: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeMs <= positionMs) idx = i;
    else break;
  }
  return idx;
}

async function loadLyrics(m: MediaInfo) {
  const key = trackKey(m);
  lyricsStore.set({ key, status: "loading", lines: [] });
  try {
    const lines = await api.lyricsFetch(m);
    if (trackKey(mediaStore.get()) !== key) return;
    lyricsStore.set(lines ? { key, status: "ready", lines } : { key, status: "none", lines: [] });
  } catch {
    if (trackKey(mediaStore.get()) === key) lyricsStore.set({ key, status: "none", lines: [] });
  }
}

export async function initMedia() {
  mediaStore.subscribe(() => {
    const m = mediaStore.get();
    const key = trackKey(m);
    if (!m || !key) return;
    if (lyricsStore.get().key === key) return;
    if (settingsStore.get()?.showLyrics === false) return;
    void loadLyrics(m);
  });
  mediaStore.set(await api.mediaGet());
  await listen<MediaInfo | null>("media-update", (e) => mediaStore.set(e.payload));
}
