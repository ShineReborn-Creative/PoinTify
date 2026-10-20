import { listen } from "@tauri-apps/api/event";
import { api, type Settings } from "../lib/api";
import { createStore } from "../lib/store";

export const settingsStore = createStore<Settings | null>(null);

let saveTimer: number | undefined;

export async function initSettings() {
  settingsStore.set(await api.settingsGet());
  await listen<Settings>("settings-changed", (e) => settingsStore.set(e.payload));
}

/** Ubah sebagian pengaturan; disimpan ke Rust dengan jeda kecil. */
export function updateSettings(patch: Partial<Settings>) {
  const current = settingsStore.get();
  if (!current) return;
  const next = { ...current, ...patch };
  settingsStore.set(next);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void api.settingsSet(settingsStore.get()!);
  }, 250);
}
