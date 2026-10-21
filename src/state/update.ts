import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { tr } from "../i18n";
import { createStore } from "../lib/store";

export type UpdateState = {
  status: "idle" | "off" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
  version?: string;
  notes?: string;
  /** 0..100 pas lagi ngunduh. */
  progress?: number;
  error?: string;
};

export const updateStore = createStore<UpdateState>({ status: "idle" });

let pending: Update | null = null;

/** Cek versi baru di GitHub Releases. Balikin info update kalau ada. */
export async function checkUpdate(): Promise<UpdateState> {
  const ready = await invoke<boolean>("updater_ready").catch(() => false);
  if (!ready) {
    const s: UpdateState = {
      status: "off",
      error: tr("Update otomatis belum disetel di versi ini.", "Automatic updates aren't set up in this build."),
    };
    updateStore.set(s);
    return s;
  }
  updateStore.set({ status: "checking" });
  try {
    pending = await check();
    const s: UpdateState = pending ? { status: "available", version: pending.version, notes: pending.body ?? "" } : { status: "none" };
    updateStore.set(s);
    return s;
  } catch (e) {
    const s: UpdateState = { status: "error", error: String(e) };
    updateStore.set(s);
    return s;
  }
}

/** Unduh, pasang, terus restart PoinTify. */
export async function installUpdate() {
  if (!pending) {
    const s = await checkUpdate();
    if (s.status !== "available" || !pending) return;
  }
  const u = pending;
  const version = u.version;
  let total = 0;
  let got = 0;
  updateStore.set({ status: "downloading", version, progress: 0 });
  try {
    await u.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        got += e.data.chunkLength;
        updateStore.set({ status: "downloading", version, progress: total ? Math.min(100, Math.round((got / total) * 100)) : undefined });
      } else if (e.event === "Finished") updateStore.set({ status: "ready", version });
    });
    updateStore.set({ status: "ready", version });
    await relaunch();
  } catch (e) {
    updateStore.set({ status: "error", version, error: String(e) });
  }
}
