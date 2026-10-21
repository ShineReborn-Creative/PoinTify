import { isEn, locale, tr } from "../i18n";
import { useEffect } from "react";
import { useNow } from "../lib/hooks";
import { setCfg } from "./layout";
import { duration, hhmm, str, WLabel, type WidgetProps } from "./common";
import { setLive } from "./data";

export const TIMEZONES: [string, string][] = [
  ["", tr("Nggak usah", "None")],
  ["Asia/Jakarta", "WIB · Jakarta"],
  ["Asia/Makassar", "WITA · Makassar"],
  ["Asia/Jayapura", "WIT · Jayapura"],
  ["Asia/Singapore", tr("Singapura", "Singapore")],
  ["Asia/Tokyo", "Tokyo"],
  ["Asia/Seoul", "Seoul"],
  ["Asia/Riyadh", tr("Mekkah", "Mecca")],
  ["Asia/Dubai", "Dubai"],
  ["Europe/London", "London"],
  ["Europe/Paris", "Paris"],
  ["America/New_York", "New York"],
  ["America/Los_Angeles", "Los Angeles"],
  ["Australia/Sydney", "Sydney"],
];

const zoneName = (tz: string) => TIMEZONES.find(([k]) => k === tz)?.[1].split(" · ").pop() ?? tz;

export function ClockWidget({ item, size }: WidgetProps) {
  const now = useNow(1000);
  const d = new Date(now);
  const tz2 = str(item.cfg.tz2);
  const seconds = item.cfg.seconds === true;
  const time = hhmm(d);
  const date = d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className={`w-clock size-${size}`}>
      <div className="w-clock-main">
        <strong className="tabular">
          {time}
          {seconds && <small>{String(d.getSeconds()).padStart(2, "0")}</small>}
        </strong>
        <span className="muted ellipsis">{size === "s" ? d.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }) : date}</span>
      </div>
      {tz2 && (
        <div className="w-clock-second">
          <span className="tabular">{hhmm(d, tz2)}</span>
          <span className="muted">{zoneName(tz2)}</span>
        </div>
      )}
    </div>
  );
}

const DAYS = isEn() ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "S", "R", "K", "J", "S", "M"];

export function CalendarWidget({ size }: WidgetProps) {
  const now = useNow(60_000);
  const d = new Date(now);
  if (size === "s") {
    return (
      <div className="w-cal-s">
        <span className="w-cal-day">{d.toLocaleDateString(locale(), { weekday: "long" })}</span>
        <strong className="tabular">{d.getDate()}</strong>
        <span className="muted">{d.toLocaleDateString(locale(), { month: "long", year: "numeric" })}</span>
      </div>
    );
  }
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Senin duluan
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: offset + days }, (_, i) => (i < offset ? 0 : i - offset + 1));
  return (
    <div className="w-cal">
      <WLabel icon="calendar">{d.toLocaleDateString(locale(), { month: "long", year: "numeric" })}</WLabel>
      <div className="w-cal-grid">
        {DAYS.map((x, i) => (
          <span key={`h${i}`} className={`w-cal-head${i === 6 ? " sun" : ""}`}>
            {x}
          </span>
        ))}
        {cells.map((n, i) => (
          <span key={i} className={`w-cal-cell${n === d.getDate() ? " today" : ""}${(i % 7) === 6 ? " sun" : ""}`}>
            {n || ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function target(item: WidgetProps["item"]) {
  const t = Date.parse(str(item.cfg.target));
  return Number.isFinite(t) ? t : null;
}

export function CountdownWidget({ item, size }: WidgetProps) {
  const now = useNow(1000);
  const t = target(item);
  const title = str(item.cfg.title) || "Acara";
  if (t === null) {
    return (
      <div className="w-count">
        <WLabel icon="hourglass">{title}</WLabel>
        <span className="muted w-hint">{tr("Atur tanggalnya lewat tombol gerigi di mode Atur.", "Set the date with the gear button in Arrange mode.")}</span>
      </div>
    );
  }
  const left = t - now;
  return (
    <div className={`w-count size-${size}`}>
      <WLabel icon="hourglass">{title}</WLabel>
      <strong className="w-big tabular">{left > 0 ? duration(left) : tr("Udah mulai!", "It's started!")}</strong>
      <span className="muted ellipsis">
        {new Date(t).toLocaleString(locale(), { weekday: size === "s" ? undefined : "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

export function CountdownLive({ item }: WidgetProps) {
  const now = useNow(1000);
  const t = target(item);
  const left = t === null ? -1 : t - now;
  const title = str(item.cfg.title) || "Acara";
  useEffect(() => {
    setLive(item.id, left > 0 && left <= 60 * 60_000 ? { priority: 6, icon: "hourglass", label: title, value: duration(left), tone: "accent" } : null);
  }, [item.id, left > 0 && left <= 60 * 60_000 ? Math.floor(left / 1000) : -1, title]);
  useEffect(() => () => setLive(item.id, null), [item.id]);
  return null;
}

/** Biar input datetime-local langsung kebaca walau string lama. */
export function setCountdownTarget(id: string, value: string) {
  setCfg(id, { target: value });
}
