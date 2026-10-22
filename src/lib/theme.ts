import { settingsStore } from "../state/settings";

/** Warna aksen yang bisa dipilih. Ungu = warna asli Pip. */
export const ACCENTS = {
  violet: "#8b7cff",
  blue: "#4da3ff",
  teal: "#22c3b4",
  green: "#34c77b",
  amber: "#ffb340",
  orange: "#ff7a45",
  pink: "#ff5c9a",
  red: "#ff5c5c",
} as const;

export type Accent = keyof typeof ACCENTS;
export type Theme = "dark" | "light" | "auto";

const media = window.matchMedia("(prefers-color-scheme: light)");

/** Pasang tema + warna aksen ke <html>. Dipanggil tiap pengaturan berubah. */
export function applyTheme() {
  const s = settingsStore.get();
  const theme = (s?.theme ?? "dark") as Theme;
  const light = theme === "light" || (theme === "auto" && media.matches);
  const root = document.documentElement;
  root.dataset.theme = light ? "light" : "dark";
  const accent = ACCENTS[(s?.accent ?? "violet") as Accent] ?? ACCENTS.violet;
  root.style.setProperty("--accent", accent);
}

export function initTheme() {
  applyTheme();
  settingsStore.subscribe(applyTheme);
  // "Ikut Windows": ganti sendiri pas mode terang/gelap Windows diubah.
  media.addEventListener("change", applyTheme);
}
