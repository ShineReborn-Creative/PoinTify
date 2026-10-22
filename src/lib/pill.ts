import type { Settings } from "./api";

/** Info yang gantian di pil pas lagi sepi. */
export type PillSlide = "app" | "cpu" | "ram" | "clock" | "temp" | "live";
export const PILL_SLIDES: PillSlide[] = ["app", "cpu", "ram", "clock", "temp", "live"];
export const PILL_ROTATE_DEFAULT = 4;

/** `C:\Program Files\Roblox\RobloxPlayerBeta.exe` → `robloxplayerbeta.exe`. */
export const exeKey = (exe: string) => (exe.split(/[\\/]/).pop() ?? exe).toLowerCase();

export function pillSlides(s?: Settings | null): PillSlide[] {
  const list = Array.isArray(s?.pillSlides) ? s.pillSlides : PILL_SLIDES;
  return PILL_SLIDES.filter((k) => list.includes(k));
}

export function pillRotateMs(s?: Settings | null): number {
  const v = Number(s?.pillRotateSecs);
  return (Number.isFinite(v) && v >= 2 ? Math.min(v, 30) : PILL_ROTATE_DEFAULT) * 1000;
}

/** App ini disembunyiin dari pil (dan nggak dicatat di statistik)? */
export function isHiddenApp(s: Settings | null | undefined, exe: string): boolean {
  const key = exeKey(exe);
  return !!s?.pillHiddenApps?.some((h) => exeKey(h.exe) === key);
}
