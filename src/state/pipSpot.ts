import { useEffect } from "react";
import { createStore } from "../lib/store";

/**
 * Berapa Pip yang lagi nongol di kanvas Beranda. Kalau nol, Pip kecil di tab
 * bar yang nongol, jadi maskotnya selalu ada (dan selalu bisa ditarik ke desktop).
 */
export const canvasPipStore = createStore(0);

export function useClaimPip(active = true) {
  useEffect(() => {
    if (!active) return;
    canvasPipStore.set((n) => n + 1);
    return () => canvasPipStore.set((n) => Math.max(0, n - 1));
  }, [active]);
}
