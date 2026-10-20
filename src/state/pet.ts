import { api } from "../lib/api";
import { collapse } from "./island";

/** Di Windows, Rust baca tombol mouse langsung. Event pointerup dari webview
 *  bisa nyasar pas jendelanya lagi digeser, jadi cuma dipakai di sistem lain. */
export const IS_WINDOWS = navigator.userAgent.includes("Windows");

/** Klik yang datang abis Pip diseret keluar nggak boleh dianggap klik notch. */
export const petDrag = { suppressClickUntil: 0 };

/** Pip ditarik keluar dari notch: jadi Pip desktop yang ngikut kursor. */
export function dragPipOut() {
  petDrag.suppressClickUntil = Date.now() + 1500;
  collapse();
  void api.petSpawnCarry().catch(() => {});
  if (IS_WINDOWS) return;
  // Cadangan buat sistem yang nggak bisa baca tombol mouse global (Linux).
  const up = () => {
    void api.petDrop();
    window.removeEventListener("pointerup", up, true);
  };
  window.addEventListener("pointerup", up, true);
}
