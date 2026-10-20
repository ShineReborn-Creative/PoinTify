import { useEffect, useRef, useState } from "react";
import {
  clampOffset,
  collapse,
  islandStore,
  saveOffset,
  setDragging,
  setOffset,
  windowWidth,
} from "../state/island";
import { compactPip } from "../state/islandDrag";
import { petDrag } from "../state/pet";

/** Elemen yang tetap berfungsi normal (diklik/diseret sendiri), bukan buat nyeret notch. */
const INTERACTIVE = "button, a, input, textarea, select, [role=slider], .shelf-card, .progress, .no-drag";
/** Geser sejauh ini ke samping baru dianggap nyeret notch. */
const START_PX = 6;

type DragState = { x: number; y: number; grab: number; active: boolean; lastX: number; lastT: number };

/**
 * Nyeret notch kanan-kiri di sepanjang atas layar. Kalau mulai nyeret pas
 * notch lagi kebuka, dia ngecil dulu jadi pil yang ngikut kursor. Posisinya
 * disimpan; pas kebuka lagi, panelnya tetap muncul di tengah.
 */
export function useIslandDrag(width: number) {
  const st = useRef<DragState | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Layar ganti ukuran: render ulang biar geserannya dibatasi lagi.
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const end = () => {
    const s = st.current;
    st.current = null;
    if (!s?.active) return;
    setDragging(false);
    saveOffset();
    petDrag.suppressClickUntil = Date.now() + 400;
    compactPip.engine?.land();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const s = islandStore.get();
    const expanded = s.mode === "expanded";
    // Pas kebuka, cuma bisa dipegang di baris tab (biar nyeleksi teks chat nggak ikut nyeret).
    if (expanded && !target.closest(".tabbar")) return;
    // Kartu izin: cuma dari judulnya.
    if (target.closest(".approval") && !target.closest(".approval-head")) return;
    const center = windowWidth() / 2 + (expanded ? 0 : clampOffset(s.offset, widthRef.current));
    st.current = {
      x: e.clientX,
      y: e.clientY,
      grab: expanded ? 0 : e.clientX - center,
      active: false,
      lastX: e.clientX,
      lastT: performance.now(),
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s) return;
    if (!(e.buttons & 1)) {
      end();
      return;
    }
    if (!s.active) {
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < START_PX || Math.abs(dx) < Math.abs(dy)) return;
      s.active = true;
      setDragging(true);
      if (islandStore.get().mode !== "compact") collapse();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Nggak bisa capture: Rust tetap nahan input selama tombol ditekan.
      }
    }
    const now = performance.now();
    const dt = Math.max(1, now - s.lastT);
    const vx = ((e.clientX - s.lastX) / dt) * 16;
    s.lastX = e.clientX;
    s.lastT = now;
    setOffset(clampOffset(e.clientX - windowWidth() / 2 - s.grab, widthRef.current));
    compactPip.engine?.nudge(vx);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onLostPointerCapture: end,
  };
}
