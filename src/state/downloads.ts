import { listen } from "@tauri-apps/api/event";
import { createStore } from "../lib/store";

/** Download yang lagi jalan di browser (dibaca dari folder Downloads). */
export type Download = { id: string; name: string; bytes: number; speed: number };
export type DownloadDone = { name: string; path: string; bytes: number };

export const downloadsStore = createStore<Download[]>([]);

const doneHandlers = new Set<(d: DownloadDone) => void>();

/** Daftar dipanggil tiap ada download yang kelar. Balikin fungsi buat berhenti. */
export function onDownloadDone(fn: (d: DownloadDone) => void) {
  doneHandlers.add(fn);
  return () => void doneHandlers.delete(fn);
}

export async function initDownloads() {
  await listen<Download[]>("downloads", (e) => downloadsStore.set(e.payload));
  await listen<DownloadDone>("download-done", (e) => doneHandlers.forEach((fn) => fn(e.payload)));
}
