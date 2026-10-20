import { api } from "../lib/api";
import { play } from "../lib/sound";
import { createStore } from "../lib/store";
import type { PipMood } from "../components/Pip";

export type Mode = "compact" | "peek" | "expanded";
export type Tab = "home" | "chat" | "agents" | "shelf" | "timer";

export type PeekAction = { label: string; primary?: boolean; run: () => void };

export type Peek = {
  id: string;
  kind: "water" | "timer" | "claude" | "shelf" | "info";
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
};

export const islandStore = createStore<IslandState>({
  mode: "compact",
  tab: "home",
  peek: null,
  hover: false,
  pinned: false,
  fileOver: false,
  visible: true,
});

export const WINDOW_W = 640;

/** Selama `until` belum lewat, hilangnya fokus jendela nggak bikin notch nutup
 *  (misalnya pas dialog pilih folder kebuka atau file lagi di-drag keluar). */
export const blurGuard = { until: 0 };

export function guardBlur(ms: number) {
  blurGuard.until = Date.now() + ms;
}

export const SIZES = {
  compactBase: { w: 196, h: 34 },
  compactWide: { w: 304, h: 34 },
  peek: { w: 392, h: 96 },
  expanded: {
    home: { w: 620, h: 262 },
    chat: { w: 620, h: 440 },
    agents: { w: 620, h: 360 },
    shelf: { w: 620, h: 262 },
    timer: { w: 620, h: 262 },
  } satisfies Record<Tab, { w: number; h: number }>,
};

function patch(p: Partial<IslandState>) {
  islandStore.set((s) => ({ ...s, ...p }));
}

export function expand(tab?: Tab) {
  const s = islandStore.get();
  if (s.mode !== "expanded") play("open");
  patch({ mode: "expanded", tab: tab ?? s.tab, peek: null });
}

export function collapse() {
  const s = islandStore.get();
  if (s.mode === "compact") return;
  if (s.mode === "expanded") play("close");
  patch({ mode: "compact", pinned: false, peek: null });
}

export function setTab(tab: Tab) {
  patch({ tab });
}

export function pin(pinned = true) {
  patch({ pinned });
}

let peekTimer: number | undefined;

/** Tampilkan kartu notifikasi kecil (kalau pulau lagi nggak kebuka). */
export function showPeek(peek: Omit<Peek, "id">) {
  const s = islandStore.get();
  const full: Peek = { ...peek, id: `${Date.now()}` };
  window.clearTimeout(peekTimer);
  if (s.mode === "expanded") {
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
export function reportHit(w: number, h: number) {
  void api.setHit({ x: (WINDOW_W - w) / 2, y: 0, w, h });
}
