import { createStore } from "../lib/store";
import { uid } from "../lib/format";
import { windowWidth } from "../state/island";
import { settingsStore, updateSettings } from "../state/settings";
import { tr } from "../i18n";

/** s = 1×1, w = 2×1 (lebar), l = 2×2 (besar), xl = 3×2 (paling besar). */
export type WidgetSize = "s" | "w" | "l" | "xl";

export const SIZE_CELLS: Record<WidgetSize, [number, number]> = {
  s: [1, 1],
  w: [2, 1],
  l: [2, 2],
  xl: [3, 2],
};

export const SIZE_LABEL: Record<WidgetSize, string> = {
  s: tr("Kecil", "Small"),
  w: tr("Lebar", "Wide"),
  l: tr("Besar", "Large"),
  xl: tr("Jumbo", "Jumbo"),
};

export type WidgetItem = {
  id: string;
  type: string;
  size: WidgetSize;
  cfg: Record<string, unknown>;
  /** Boleh nongol di notch kecil (Live). */
  live?: boolean;
};

export type WidgetLayout = { v: 1; items: WidgetItem[] };

// Ukuran sel grid (px logis). Tingginya pas 2 baris di panel Beranda.
export const CELL_W = 140;
export const CELL_H = 99;
export const GAP = 10;
export const ROWS = 2;
const PANEL_MIN_W = 620;
const PANEL_PAD = 24;

const item = (type: string, size: WidgetSize, cfg: Record<string, unknown> = {}, live?: boolean): WidgetItem => ({
  id: uid(),
  type,
  size,
  cfg,
  live,
});

/** Susunan awal: mirip Beranda lama, plus beberapa widget baru biar kelihatan isinya. */
export function defaultLayout(): WidgetLayout {
  return {
    v: 1,
    items: [
      item("music", "xl"),
      item("clock", "s"),
      item("weather", "s"),
      item("timer", "s"),
      item("water", "s"),
      item("system", "w", {}, true),
      item("prayer", "w", {}, true),
    ],
  };
}

function valid(v: unknown): v is WidgetLayout {
  const l = v as WidgetLayout;
  return !!l && l.v === 1 && Array.isArray(l.items) && l.items.every((i) => i && typeof i.id === "string" && typeof i.type === "string");
}

export const widgetStore = createStore<WidgetLayout>(defaultLayout());

export type EditState = { editing: boolean; configId: string | null; gallery: boolean; dragId: string | null };
export const editStore = createStore<EditState>({ editing: false, configId: null, gallery: false, dragId: null });

let loaded = false;

/** Ambil susunan dari pengaturan (sekali, pas pengaturan udah kebaca). */
export function initWidgets() {
  const apply = () => {
    const s = settingsStore.get();
    if (!s || loaded) return;
    loaded = true;
    if (valid(s.widgets)) {
      widgetStore.set({ v: 1, items: s.widgets.items.map((i) => ({ ...i, cfg: i.cfg ?? {} })) });
    }
  };
  apply();
  settingsStore.subscribe(apply);
}

function commit(next: WidgetLayout, save = true) {
  widgetStore.set(next);
  if (save) updateSettings({ widgets: next });
}

/** Simpen susunan sekarang (abis selesai nyeret). */
export function saveLayout() {
  updateSettings({ widgets: widgetStore.get() });
}

export function addWidget(type: string, size: WidgetSize, cfg: Record<string, unknown> = {}, live?: boolean) {
  const it = item(type, size, cfg, live);
  commit({ v: 1, items: [...widgetStore.get().items, it] });
  return it.id;
}

export function removeWidget(id: string) {
  commit({ v: 1, items: widgetStore.get().items.filter((i) => i.id !== id) });
  const e = editStore.get();
  if (e.configId === id) editStore.set({ ...e, configId: null });
}

export function updateWidget(id: string, patch: Partial<WidgetItem>) {
  commit({ v: 1, items: widgetStore.get().items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
}

/** Ubah sebagian isi pengaturan satu widget (juga dipakai buat nyimpen to-do, catatan, dll). */
export function setCfg(id: string, patch: Record<string, unknown>) {
  commit({
    v: 1,
    items: widgetStore.get().items.map((i) => (i.id === id ? { ...i, cfg: { ...i.cfg, ...patch } } : i)),
  });
}

/** `save = false` pas lagi diseret: susunan berubah langsung, disimpen pas dilepas. */
export function moveWidget(id: string, toIndex: number, save = true) {
  const items = [...widgetStore.get().items];
  const from = items.findIndex((i) => i.id === id);
  if (from < 0 || from === toIndex) return;
  const [it] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, it);
  commit({ v: 1, items }, save);
}

export function resetLayout() {
  commit(defaultLayout());
}

export function setEditing(editing: boolean) {
  editStore.set({ editing, configId: null, gallery: false, dragId: null });
}

export function openConfig(id: string | null) {
  editStore.set({ ...editStore.get(), configId: id, gallery: false });
}

export function openGallery(open: boolean) {
  editStore.set({ ...editStore.get(), gallery: open, configId: null });
}

export function setDragId(dragId: string | null) {
  editStore.set({ ...editStore.get(), dragId });
}

// ---------------------------------------------------------------------------
// Penyusunan grid: 2 baris, nambah kolom ke kanan seiring banyaknya widget.
// ---------------------------------------------------------------------------

export type Placed = { col: number; row: number; w: number; h: number };

/** Taruh tiap widget di slot kosong pertama (kolom demi kolom, atas ke bawah). */
export function pack(sizes: { id: string; size: WidgetSize }[]): { pos: Map<string, Placed>; cols: number } {
  const taken: boolean[][] = [];
  const free = (c: number, r: number) => !taken[c]?.[r];
  const pos = new Map<string, Placed>();
  let cols = 0;
  for (const { id, size } of sizes) {
    const [w, h] = SIZE_CELLS[size];
    let done = false;
    for (let c = 0; !done; c++) {
      for (let r = 0; r + h <= ROWS && !done; r++) {
        let ok = true;
        for (let dc = 0; dc < w && ok; dc++) for (let dr = 0; dr < h && ok; dr++) ok = free(c + dc, r + dr);
        if (!ok) continue;
        for (let dc = 0; dc < w; dc++) {
          taken[c + dc] ??= [];
          for (let dr = 0; dr < h; dr++) taken[c + dc][r + dr] = true;
        }
        pos.set(id, { col: c, row: r, w, h });
        cols = Math.max(cols, c + w);
        done = true;
      }
    }
  }
  return { pos, cols: Math.max(cols, 1) };
}

export const ADD_TILE = "__add__";

/** Susunan yang lagi ditampilin (plus kotak "Tambah" pas mode Atur). */
export function currentPack(layout: WidgetLayout, editing: boolean) {
  const sizes = layout.items.map((i) => ({ id: i.id, size: i.size }));
  if (editing) sizes.push({ id: ADD_TILE, size: "s" });
  return pack(sizes);
}

export function gridWidth(cols: number) {
  return cols * CELL_W + (cols - 1) * GAP;
}

/** Lebar panel Beranda: ngikutin jumlah kolom, dibatesin lebar layar. */
export function homePanelWidth(cols: number) {
  return Math.round(Math.min(windowWidth() - 24, Math.max(PANEL_MIN_W, gridWidth(cols) + PANEL_PAD)));
}
