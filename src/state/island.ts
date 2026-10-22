import { api } from "../lib/api";
import { play } from "../lib/sound";
import { createStore } from "../lib/store";
import { quietStore } from "./quiet";
import type { PipMood } from "../components/Pip";

export type Mode = "compact" | "peek" | "expanded";
export type Tab = "home" | "chat" | "agents" | "shelf" | "timer" | "palette";

export type PeekAction = { label: string; primary?: boolean; run: () => void };

export type Peek = {
  id: string;
  kind: "water" | "timer" | "claude" | "shelf" | "info" | "tour";
  title: string;
  body?: string;
  mood: PipMood;
  actions?: PeekAction[];
  /** Klik di badan kartu buka tab ini. */
  openTab?: Tab;
  /** Hilang sendiri setelah sekian ms (kosong = sampai ditutup). */
  timeoutMs?: number;
};

export type IslandState = {
  mode: Mode;
  tab: Tab;
  peek: Peek | null;
  hover: boolean;
  /** Tetap kebuka walau kursor keluar (lagi ngetik, abis diklik). */
  pinned: boolean;
  /** Ada file yang lagi di-drag di atas notch. */
  fileOver: boolean;
  /** Notch keliatan (nggak lagi sembunyi karena app fullscreen). */
  visible: boolean;
  /** Geseran notch dari tengah layar (px logis). Kebuka penuh selalu di tengah. */
  offset: number;
  /** Notch lagi diseret kanan-kiri. */
  dragging: boolean;
};

export const OFFSET_KEY = "pointify.island.offset";

function loadOffset(): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

export const islandStore = createStore<IslandState>({
  mode: "compact",
  tab: "home",
  peek: null,
  hover: false,
  pinned: false,
  fileOver: false,
  visible: true,
  offset: loadOffset(),
  dragging: false,
});

/** Jendela notch selebar layar; pulau ditaruh di tengah plus `offset`. */
export function windowWidth() {
  return window.innerWidth || 640;
}

/** Batasi geseran biar pulau selebar `w` nggak keluar layar. */
export function clampOffset(offset: number, w: number) {
  const max = Math.max(0, windowWidth() / 2 - w / 2 - 12);
  return Math.max(-max, Math.min(max, offset));
}

export function setOffset(offset: number) {
  patch({ offset });
}

export function setDragging(dragging: boolean) {
  patch({ dragging });
}

export function saveOffset() {
  try {
    localStorage.setItem(OFFSET_KEY, String(Math.round(islandStore.get().offset)));
  } catch {
    // Nggak kesimpen: next nyala balik ke tengah, nggak apa-apa.
  }
}

/** Selama `until` belum lewat, hilangnya fokus jendela nggak bikin notch nutup
 *  (misalnya pas dialog pilih folder kebuka atau file lagi di-drag keluar). */
export const blurGuard = { until: 0 };

export function guardBlur(ms: number) {
  blurGuard.until = Date.now() + ms;
}

/** Tinggi command palette, ngikutin banyaknya hasil. */
export const paletteHeightStore = createStore(330);

export const SIZES = {
  compactBase: { w: 196, h: 34 },
  compactWide: { w: 304, h: 34 },
  /** Lagi sepi: logo app, RAM, CPU, jam, suhu gantian. */
  compactAmbient: { w: 252, h: 34 },
  /** Lagi muter lagu yang ada liriknya: lirik jalan di tengah. */
  compactLyrics: { w: 460, h: 34 },
  peek: { w: 392, h: 96 },
  /** Kartu tour perkenalan: teksnya lebih panjang. */
  tour: { w: 488, h: 128 },
  expanded: {
    home: { w: 620, h: 262 },
    chat: { w: 620, h: 440 },
    agents: { w: 620, h: 360 },
    shelf: { w: 620, h: 262 },
    timer: { w: 620, h: 262 },
    palette: { w: 600, h: 330 },
  } satisfies Record<Tab, { w: number; h: number }>,
};

function patch(p: Partial<IslandState>) {
  islandStore.set((s) => ({ ...s, ...p }));
}

/** Tab sebelum command palette dibuka. Palette cuma sekali pakai: pas notch
 *  nutup, hover berikutnya balik ke tab ini, bukan ke palette lagi. */
let tabBeforePalette: Tab = "home";

export function expand(tab?: Tab) {
  const s = islandStore.get();
  if (s.mode !== "expanded") play("open");
  if (tab === "palette" && s.tab !== "palette") tabBeforePalette = s.tab;
  patch({ mode: "expanded", tab: tab ?? s.tab, peek: null });
}

/** Dipanggil tepat sebelum notch yang kebuka penuh nutup (isinya masih ada). */
export const beforeCollapse = new Set<() => void>();

export function collapse() {
  const s = islandStore.get();
  if (s.mode === "compact") return;
  if (s.mode === "expanded") {
    play("close");
    for (const fn of beforeCollapse) fn();
  }
  patch({ mode: "compact", pinned: false, peek: null, tab: s.tab === "palette" ? tabBeforePalette : s.tab });
}

export function setTab(tab: Tab) {
  patch({ tab });
}

export function pin(pinned = true) {
  patch({ pinned });
}

let peekTimer: number | undefined;

/** Tampilkan kartu notifikasi kecil (kalau pulau lagi nggak kebuka). */
export function showPeek(peek: Omit<Peek, "id">, opts: { force?: boolean } = {}) {
  // Mode tenang: notif kecil nggak usah nyembul (kecuali yang diminta lu sendiri, kayak tour).
  if (quietStore.get() && !opts.force) return;
  const s = islandStore.get();
  const full: Peek = { ...peek, id: `${Date.now()}` };
  window.clearTimeout(peekTimer);
  if (s.mode === "expanded" && !opts.force) {
    // Lagi dibuka: nggak usah ganggu, cukup bunyi kecil.
    return;
  }
  patch({ mode: "peek", peek: full });
  if (peek.timeoutMs) {
    peekTimer = window.setTimeout(() => {
      const now = islandStore.get();
      if (now.peek?.id === full.id && !now.hover) patch({ mode: "compact", peek: null });
    }, peek.timeoutMs);
  }
}

export function dismissPeek() {
  window.clearTimeout(peekTimer);
  const s = islandStore.get();
  if (s.mode === "peek") patch({ mode: "compact", peek: null });
}

export function setHover(hover: boolean) {
  patch({ hover });
}

export function setFileOver(fileOver: boolean) {
  patch({ fileOver });
}

export function setVisible(visible: boolean) {
  patch({ visible });
}

/** Kirim kotak area pulau ke Rust (buat click-through & deteksi hover). */
export function reportHit(w: number, h: number, offset = 0) {
  void api.setHit({ x: (windowWidth() - w) / 2 + offset, y: 0, w, h });
}
