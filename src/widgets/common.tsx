import type { ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import type { WidgetItem, WidgetSize } from "./layout";

export type WidgetProps = { item: WidgetItem; size: WidgetSize };

/** Judul kecil di pojok widget. */
export function WLabel({ icon, children, right }: { icon: IconName; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="w-label">
      <Icon name={icon} size={13} />
      <span className="ellipsis">{children}</span>
      {right && <span className="w-label-right">{right}</span>}
    </div>
  );
}

/** Bar kecil 0..1, misalnya pemakaian RAM. */
export function Meter({ value, tone }: { value: number; tone?: "warn" | "good" | "accent" }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="w-meter">
      <div className={`w-meter-fill${tone ? ` ${tone}` : ""}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Pesan pas widget belum siap atau gagal. */
export function WState({ children, error }: { children: ReactNode; error?: boolean }) {
  return <div className={`w-state${error ? " error" : ""}`}>{children}</div>;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** "3j 12m", "12 hari", "45d". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d >= 2) return `${d} hari`;
  if (d === 1) return `1 hari ${h}j`;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s % 60}d`;
  return `${s}d`;
}

export function hhmm(d: Date, timeZone?: string) {
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timeZone || undefined }).replace(".", ":");
}
