import { createStore } from "./lib/store";

/**
 * Bahasa UI: Indonesia atau Inggris. Teks ditulis berpasangan langsung di
 * tempatnya, `tr("Simpan", "Save")`, jadi nggak ada kamus terpisah yang bisa
 * ketinggalan. Ganti bahasa = tiap jendela dimuat ulang sekali, biar teks
 * yang disiapin pas modul dimuat (daftar widget, dll) ikut keganti.
 */
export type Lang = "id" | "en";

/** "auto" ikut bahasa Windows/browser: Indonesia kalau sistemnya Indonesia, selain itu Inggris. */
export function resolveLang(pref?: string | null): Lang {
  if (pref === "id" || pref === "en") return pref;
  const sys = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  return sys.startsWith("id") || sys.startsWith("in") ? "id" : "en";
}

const KEY = "pointify.lang";

function cached(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Dibaca pas modul dimuat, sebelum pengaturan dari Rust nyampe. */
export const langStore = createStore<Lang>(resolveLang(cached()));
document.documentElement.lang = langStore.get();

/** Pengaturan bahasa nyampe/berubah: kalau beda sama yang kepake, muat ulang jendela ini. */
export function setLanguage(pref?: string | null) {
  try {
    localStorage.setItem(KEY, pref || "auto");
  } catch {
    // Nggak kesimpen: next buka nebak dari bahasa sistem dulu.
  }
  const l = resolveLang(pref);
  // Kasih jeda dikit biar perubahan pengaturannya sempet kekirim ke Rust dulu.
  if (l !== langStore.get()) window.setTimeout(() => location.reload(), 700);
}

export const isEn = () => langStore.get() === "en";

/** Pilih teks sesuai bahasa yang aktif. */
export function tr(id: string, en: string): string {
  return langStore.get() === "en" ? en : id;
}

/** Locale buat format tanggal/jam/angka. */
export const locale = () => (langStore.get() === "en" ? "en-US" : "id-ID");
