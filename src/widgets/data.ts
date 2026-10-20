import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";
import { api, type ClipItem, type SysStats } from "../lib/api";
import { createStore, type Store } from "../lib/store";

// ---------------------------------------------------------------------------
// Data yang di-poll bareng: banyak widget bisa minta data yang sama (misalnya
// statistik sistem), tapi permintaannya cuma jalan sekali dan cuma selama ada
// widget yang lagi nampilin data itu.
// ---------------------------------------------------------------------------

export type Polled<T> = { data?: T; error?: string; at: number; loading: boolean };

type Entry = {
  store: Store<Polled<unknown>>;
  users: number;
  timer?: number;
  interval: number;
  fetch: () => Promise<unknown>;
};

const entries = new Map<string, Entry>();

async function run(e: Entry) {
  e.store.set((s) => ({ ...s, loading: true }));
  try {
    const data = await e.fetch();
    e.store.set({ data, at: Date.now(), loading: false });
  } catch (err) {
    e.store.set((s) => ({ ...s, error: String(err).replace(/^Error:\s*/, ""), loading: false }));
  }
}

function entry(key: string, fetch: () => Promise<unknown>, interval: number): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { store: createStore<Polled<unknown>>({ at: 0, loading: false }), users: 0, interval, fetch };
    entries.set(key, e);
  }
  e.fetch = fetch;
  e.interval = Math.min(e.interval, interval);
  return e;
}

/**
 * Ambil data tiap `interval` ms selama komponen ini kepasang.
 * Data terakhir disimpen, jadi pas widget muncul lagi langsung ada isinya.
 */
export function usePolled<T>(key: string | null, fetch: () => Promise<T>, interval: number): Polled<T> {
  const e = key ? entry(key, fetch, interval) : null;
  useEffect(() => {
    if (!e) return;
    e.users++;
    const stale = Date.now() - e.store.get().at > e.interval;
    if (e.users === 1) {
      if (stale) void run(e);
      e.timer = window.setInterval(() => void run(e), e.interval);
    }
    return () => {
      e.users--;
      if (e.users === 0) window.clearInterval(e.timer);
    };
  }, [e]);
  const empty = { at: 0, loading: false };
  return useSyncExternalStore(
    e ? e.store.subscribe : () => () => {},
    e ? () => e.store.get() : () => empty,
  ) as Polled<T>;
}

/** Paksa ambil ulang sekarang (tombol refresh). */
export function refreshPolled(key: string) {
  const e = entries.get(key);
  if (e) void run(e);
}

// ---------------------------------------------------------------------------
// Sistem
// ---------------------------------------------------------------------------

export function useSysStats(interval = 2000) {
  return usePolled<SysStats>("sys", () => api.sysStats(), interval);
}

export function bytes(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e11 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${Math.round(n)} B`;
}

export function speed(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

// ---------------------------------------------------------------------------
// JSON dari internet (cuaca, jadwal sholat, kurs, GitHub, widget kustom)
// ---------------------------------------------------------------------------

export function useJson<T>(url: string | null, interval: number) {
  return usePolled<T>(url, () => api.httpGetJson<T>(url as string), interval);
}

type Place = { name: string; lat: number; lon: number; tz: string };
const GEO_KEY = "pointify.geocode.v1";

function geoCache(): Record<string, Place> {
  try {
    return JSON.parse(localStorage.getItem(GEO_KEY) || "{}");
  } catch {
    return {};
  }
}

/** Nama kota → koordinat (Open-Meteo), disimpen biar nggak nanya terus. */
export async function geocode(city: string): Promise<Place> {
  const key = city.trim().toLowerCase();
  const cached = geoCache()[key];
  if (cached) return cached;
  type Res = { results?: { name: string; latitude: number; longitude: number; timezone: string }[] };
  const r = await api.httpGetJson<Res>(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&language=id&format=json&name=${encodeURIComponent(city.trim())}`,
  );
  const hit = r.results?.[0];
  if (!hit) throw new Error(`Kota "${city}" nggak ketemu`);
  const place = { name: hit.name, lat: hit.latitude, lon: hit.longitude, tz: hit.timezone };
  try {
    localStorage.setItem(GEO_KEY, JSON.stringify({ ...geoCache(), [key]: place }));
  } catch {
    // Nggak kesimpen, nanti nanya lagi aja.
  }
  return place;
}

/** Ambil nilai dari JSON pakai jalur titik, misal `data.items.0.price`. */
export function pick(obj: unknown, path: string): unknown {
  if (!path.trim()) return obj;
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export const clipStore = createStore<ClipItem[]>([]);
let clipStarted = false;

export function initClipboard() {
  if (clipStarted) return;
  clipStarted = true;
  void api.clipboardList().then((items) => Array.isArray(items) && clipStore.set(items)).catch(() => {});
  void listen<ClipItem[]>("clipboard-changed", (e) => clipStore.set(e.payload));
}

// ---------------------------------------------------------------------------
// Live di notch kecil: widget yang lagi penting ngelapor ke sini.
// ---------------------------------------------------------------------------

export type LiveInfo = {
  /** Makin besar makin penting. */
  priority: number;
  icon: string;
  label: string;
  value: string;
  tone?: "warn" | "accent" | "good";
};

export const liveStore = createStore<Record<string, LiveInfo>>({});

export function setLive(id: string, info: LiveInfo | null) {
  const cur = liveStore.get();
  const prev = cur[id];
  if (!info) {
    if (!prev) return;
    const next = { ...cur };
    delete next[id];
    liveStore.set(next);
    return;
  }
  if (prev && prev.label === info.label && prev.value === info.value && prev.priority === info.priority && prev.tone === info.tone) return;
  liveStore.set({ ...cur, [id]: info });
}

/** Kondisi buat reaksi Pip (keringetan, lemes, kehujanan). */
export const pipConditionStore = createStore<{ hot: boolean; tired: boolean; rain: boolean }>({
  hot: false,
  tired: false,
  rain: false,
});
