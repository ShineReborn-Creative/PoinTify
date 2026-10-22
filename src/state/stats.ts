import { todayKey } from "../lib/format";
import { createStore } from "../lib/store";
import { isHiddenApp } from "../lib/pill";
import { foregroundStore } from "./foreground";
import { settingsStore } from "./settings";
import { mediaStore } from "./media";
import { timerStore } from "./timer";
import { waterStore } from "./water";

/**
 * Statistik harian buat widget "Minggu ini". Semuanya cuma disimpen di PC
 * ini (localStorage jendela notch), nggak pernah dikirim ke mana-mana.
 */
export type DayStats = {
  focusMs: number;
  sessions: number;
  water: number;
  /** Lama tiap app dipake (ms), per exe. */
  apps: Record<string, { name: string; ms: number }>;
  /** Berapa kali tiap lagu diputer (minimal 30 detik). */
  songs: Record<string, { title: string; artist: string; plays: number }>;
};

export type StatsState = { v: 1; days: Record<string, DayStats> };

const KEY = "pointify.stats.v1";
const KEEP_DAYS = 35;
const APP_TICK_MS = 15_000;
const SONG_MIN_MS = 30_000;

function load(): StatsState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as StatsState | null;
    if (s?.v === 1 && s.days) return s;
  } catch {
    /* mulai dari kosong */
  }
  return { v: 1, days: {} };
}

export const statsStore = createStore<StatsState>(load());

const empty = (): DayStats => ({ focusMs: 0, sessions: 0, water: 0, apps: {}, songs: {} });

function save() {
  const s = statsStore.get();
  // Buang hari yang udah kelamaan biar nggak numpuk.
  const keys = Object.keys(s.days).sort();
  if (keys.length > KEEP_DAYS) for (const k of keys.slice(0, keys.length - KEEP_DAYS)) delete s.days[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* penuh/keblok: statistik cuma ilang, app tetap jalan */
  }
}

function update(fn: (d: DayStats) => void) {
  const day = todayKey();
  statsStore.set((s) => {
    const d: DayStats = { ...empty(), ...(s.days[day] ?? {}) };
    d.apps = { ...d.apps };
    d.songs = { ...d.songs };
    fn(d);
    return { ...s, days: { ...s.days, [day]: d } };
  });
}

/** Tanggal (key todayKey) n hari ke belakang, dari yang paling lama. */
export function lastDays(n: number): { key: string; date: Date }[] {
  const out: { key: string; date: Date }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push({ key: todayKey(d), date: d });
  }
  return out;
}

let started = false;

export function initStats() {
  if (started) return;
  started = true;

  // Fokus & minum: timer/minum udah nyimpen angka hari ini, tinggal disalin.
  const syncCounters = () => {
    const t = timerStore.get();
    const w = waterStore.get();
    update((d) => {
      if (t.day === todayKey()) {
        d.focusMs = Math.max(d.focusMs, t.todayFocusMs);
        d.sessions = Math.max(d.sessions, t.todaySessions);
      }
      if (w.day === todayKey()) d.water = Math.max(d.water, w.count);
    });
  };
  timerStore.subscribe(syncCounters);
  waterStore.subscribe(syncCounters);

  // Waktu layar per app: tiap 15 detik, tambahin ke app yang lagi di depan.
  // App yang lu sembunyiin dari pil juga nggak dicatat.
  window.setInterval(() => {
    const app = foregroundStore.get();
    if (!app || document.visibilityState === "hidden" || isHiddenApp(settingsStore.get(), app.exe)) return;
    update((d) => {
      const cur = d.apps[app.exe] ?? { name: app.name, ms: 0 };
      d.apps[app.exe] = { name: app.name, ms: cur.ms + APP_TICK_MS };
    });
  }, APP_TICK_MS);

  // Lagu: dihitung sekali per putar, kalau udah jalan 30 detik. Pause terus
  // lanjut lagu yang sama nggak dihitung dua kali.
  let current = "";
  let counted = "";
  let timer: number | undefined;
  const onMedia = () => {
    const m = mediaStore.get();
    const key = m && m.isPlaying && m.kind !== "video" ? `${m.title}|${m.artist}` : "";
    if (key === current) return;
    current = key;
    window.clearTimeout(timer);
    if (!key || !m) return;
    if (key !== counted) counted = "";
    if (counted) return;
    timer = window.setTimeout(() => {
      if (current !== key) return;
      counted = key;
      update((d) => {
        const s = d.songs[key] ?? { title: m.title, artist: m.artist, plays: 0 };
        d.songs[key] = { ...s, plays: s.plays + 1 };
      });
    }, SONG_MIN_MS);
  };
  mediaStore.subscribe(onMedia);
  // Lagu yang udah keputer pas PoinTify baru nyala juga diitung.
  onMedia();

  statsStore.subscribe(save);
  syncCounters();
}
