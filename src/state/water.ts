import { todayKey } from "../lib/format";
import { createStore } from "../lib/store";
import { settingsStore } from "./settings";

export type WaterState = {
  day: string;
  count: number;
  nextAt: number;
  lastDrinkAt: number | null;
};

const STORAGE = "pointify.water.v1";

function interval(): number {
  return Math.max(10, settingsStore.get()?.waterIntervalMinutes ?? 45) * 60_000;
}

function load(): WaterState {
  const fresh: WaterState = { day: todayKey(), count: 0, nextAt: Date.now() + 45 * 60_000, lastDrinkAt: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as WaterState | null;
    if (!saved) return fresh;
    // Abis PC dinyalain lagi, kasih jeda dulu sebelum ngingetin.
    const nextAt = Math.max(saved.nextAt, Date.now() + 10 * 60_000);
    if (saved.day !== todayKey()) return { ...saved, day: todayKey(), count: 0, nextAt };
    return { ...saved, nextAt };
  } catch {
    return fresh;
  }
}

export const waterStore = createStore<WaterState>(load());

waterStore.subscribe(() => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(waterStore.get()));
  } catch {
    /* abaikan */
  }
});

export function drink() {
  const now = Date.now();
  waterStore.set((s) => ({
    ...s,
    day: todayKey(),
    count: (s.day === todayKey() ? s.count : 0) + 1,
    lastDrinkAt: now,
    nextAt: now + interval(),
  }));
}

export function undoDrink() {
  waterStore.set((s) => ({ ...s, count: Math.max(0, s.count - 1) }));
}

export function snoozeWater(minutes: number) {
  waterStore.set((s) => ({ ...s, nextAt: Date.now() + minutes * 60_000 }));
}

function withinActiveHours(d: Date): boolean {
  const s = settingsStore.get();
  const start = s?.waterStartHour ?? 8;
  const end = s?.waterEndHour ?? 22;
  const h = d.getHours();
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** True kalau udah waktunya ngingetin minum. */
export function waterDue(now: number): boolean {
  const s = settingsStore.get();
  if (!s?.waterEnabled) return false;
  const w = waterStore.get();
  if (w.day !== todayKey()) {
    waterStore.set({ ...w, day: todayKey(), count: 0 });
  }
  if (!withinActiveHours(new Date(now))) return false;
  return now >= w.nextAt;
}
