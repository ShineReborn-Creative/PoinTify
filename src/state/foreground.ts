import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { api } from "../lib/api";
import { createStore } from "../lib/store";

/** App yang lagi di depan (buat logo di pil notch). */
export type ForegroundApp = { exe: string; name: string; icon: string | null };

export const foregroundStore = createStore<ForegroundApp | null>(null);

const icons = new Map<string, string | null>();
/** App terakhir yang dikabarin Rust (buat buang hasil ikon yang telat nyampe). */
let wanted: string | null = null;

async function setApp(app: { exe: string; name: string } | null) {
  wanted = app?.exe ?? null;
  if (!app) return foregroundStore.set(null);
  let icon = icons.get(app.exe);
  if (icon === undefined) {
    icon = await api.launchIcon(app.exe).catch(() => null);
    icons.set(app.exe, icon);
  }
  if (wanted !== app.exe) return;
  foregroundStore.set({ ...app, icon });
}

export async function initForeground() {
  const first = await invoke<{ exe: string; name: string } | null>("foreground_get").catch(() => null);
  void setApp(first);
  await listen<{ exe: string; name: string } | null>("foreground-app", (e) => void setApp(e.payload));
}
