import { listen } from "@tauri-apps/api/event";
import { api, type Settings } from "../lib/api";
import { createStore } from "../lib/store";

export const settingsStore = createStore<Settings | null>(null);

let saveTimer: number | undefined;
/** Perubahan dari jendela ini yang belum kekirim ke Rust. */
let pending: Partial<Settings> = {};

export async function initSettings() {
  settingsStore.set(await api.settingsGet());
  // Kabar dari Rust/jendela lain: ambil, tapi perubahan lokal yang belum
  // kesimpen tetap dipakai (biar nggak "balik lagi" sebelum sempat dikirim).
  await listen<Settings>("settings-changed", (e) => settingsStore.set({ ...e.payload, ...pending }));
}

/** Ubah sebagian pengaturan; yang dikirim ke Rust cuma bagian yang berubah. */
export function updateSettings(patch: Partial<Settings>) {
  const current = settingsStore.get();
  if (!current) return;
  pending = { ...pending, ...patch };
  settingsStore.set({ ...current, ...patch });
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const send = pending;
    pending = {};
    void api.settingsPatch(send).catch((e) => console.error("pengaturan gagal disimpan", e));
  }, 250);
}
