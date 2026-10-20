import { createStore } from "../lib/store";

const KEY = "pointify.quiet.v1";

function load() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Mode tenang: notif yang nyembul dan suara PoinTify diem dulu. Kartu izin Claude tetap muncul. */
export const quietStore = createStore<boolean>(load());

export function setQuiet(on: boolean) {
  quietStore.set(on);
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Nggak kesimpen; abis restart balik normal.
  }
}
