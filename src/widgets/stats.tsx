import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { isEn, locale, tr } from "../i18n";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { lastDays, statsStore, type DayStats } from "../state/stats";
import { isHiddenApp } from "../lib/pill";
import { settingsStore } from "../state/settings";
import type { Settings } from "../lib/api";
import { WLabel, type WidgetProps } from "./common";

type Metric = "focus" | "water" | "screen";

/** Pilihan Fokus/Minum/Layar diinget, biar nggak balik ke Fokus tiap notch nutup. */
const METRIC_KEY = "pointify.stats.metric";
function loadMetric(): Metric {
  try {
    const v = localStorage.getItem(METRIC_KEY);
    return v === "water" || v === "screen" ? v : "focus";
  } catch {
    return "focus";
  }
}
function saveMetric(m: Metric) {
  try {
    localStorage.setItem(METRIC_KEY, m);
  } catch {
    // nggak kesimpen, nggak apa-apa
  }
}

/** 135 menit → "2j 15m" / "2h 15m". */
function hm(ms: number): string {
  const m = Math.round(ms / 60_000);
  const h = Math.floor(m / 60);
  if (!h) return `${m}m`;
  return `${h}${isEn() ? "h" : "j"}${m % 60 ? ` ${m % 60}m` : ""}`;
}

/** Total waktu layar, tanpa app yang disembunyiin. */
const screenMs = (d: DayStats | undefined, s: Settings | null) =>
  d ? Object.entries(d.apps).reduce((sum, [exe, a]) => (isHiddenApp(s, exe) ? sum : sum + a.ms), 0) : 0;

const ICONS = new Map<string, string | null>();
function AppIcon({ exe }: { exe: string }) {
  const [src, setSrc] = useState(ICONS.get(exe));
  useEffect(() => {
    if (ICONS.has(exe)) return;
    let alive = true;
    void api
      .launchIcon(exe)
      .catch(() => null)
      .then((v) => {
        ICONS.set(exe, v);
        if (alive) setSrc(v);
      });
    return () => {
      alive = false;
    };
  }, [exe]);
  return src ? <img className="w-stats-icon" src={src} alt="" /> : <Icon name="desktop" size={13} />;
}

/** Ringkasan 7 hari: fokus, minum, waktu app, lagu & app teratas. Datanya cuma di PC ini. */
export function StatsWidget({ size }: WidgetProps) {
  const stats = useStore(statsStore);
  const settings = useStore(settingsStore);
  const [metric, setMetricState] = useState<Metric>(loadMetric);
  const setMetric = (m: Metric) => {
    setMetricState(m);
    saveMetric(m);
  };
  const days = lastDays(7);
  const week = days.map((d) => stats.days[d.key]);

  const value = (d: DayStats | undefined) => (!d ? 0 : metric === "focus" ? d.focusMs : metric === "water" ? d.water : screenMs(d, settings));
  const values = week.map(value);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const totalText = metric === "water" ? tr(`${total} gelas`, `${total} glasses`) : hm(total);

  const tops = useMemo(() => {
    const apps: Record<string, { name: string; ms: number }> = {};
    const songs: Record<string, { title: string; artist: string; plays: number }> = {};
    for (const d of week) {
      if (!d) continue;
      for (const [exe, a] of Object.entries(d.apps)) if (!isHiddenApp(settings, exe)) apps[exe] = { name: a.name, ms: (apps[exe]?.ms ?? 0) + a.ms };
      for (const [k, s] of Object.entries(d.songs)) songs[k] = { ...s, plays: (songs[k]?.plays ?? 0) + s.plays };
    }
    return {
      apps: Object.entries(apps)
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 3),
      songs: Object.values(songs)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 3),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, settings?.pillHiddenApps]);

  const label = { focus: tr("Fokus", "Focus"), water: tr("Minum", "Water"), screen: tr("Layar", "Screen") };
  const metricSeg = (
    <span className="w-stats-seg" onPointerDown={(e) => e.stopPropagation()}>
      {(Object.keys(label) as Metric[]).map((m) => (
        <button key={m} className={metric === m ? "on" : ""} onClick={() => setMetric(m)}>
          {label[m]}
        </button>
      ))}
    </span>
  );

  const chart = (
    <div className="w-stats-chart" role="img" aria-label={`${label[metric]}: ${totalText}`}>
      {days.map((d, i) => (
        <div key={d.key} className={`w-stats-col${i === days.length - 1 ? " today" : ""}`} title={`${d.date.toLocaleDateString(locale(), { weekday: "long" })}: ${metric === "water" ? values[i] : hm(values[i])}`}>
          <span className="w-stats-bar" style={{ height: `${Math.max(4, (values[i] / max) * 100)}%`, opacity: values[i] ? 1 : 0.35 }} />
          <span className="w-stats-day">{d.date.toLocaleDateString(locale(), { weekday: "narrow" })}</span>
        </div>
      ))}
    </div>
  );

  if (size === "w") {
    return (
      <div className="w-stats size-w">
        <div className="w-stats-left">
          <WLabel icon="calendar">{tr("Minggu ini", "This week")}</WLabel>
          <strong className="w-big">{hm(week.reduce((s, d) => s + (d?.focusMs ?? 0), 0))}</strong>
          <span className="muted">{tr("fokus 7 hari", "focused in 7 days")}</span>
        </div>
        {chart}
      </div>
    );
  }

  return (
    <div className={`w-stats size-${size}`}>
      <div className="w-stats-main">
        <WLabel icon="calendar" right={metricSeg}>
          {tr("Minggu ini", "This week")}
        </WLabel>
        <div className="w-stats-total">
          <strong className="w-big">{totalText}</strong>
          <span className="muted">
            {!week.some(Boolean) || (!total && metric === "screen")
              ? tr("mulai kecatet hari ini", "tracking starts today")
              : metric === "focus"
              ? tr(`${week.reduce((s, d) => s + (d?.sessions ?? 0), 0)} sesi`, `${week.reduce((s, d) => s + (d?.sessions ?? 0), 0)} sessions`)
              : metric === "water"
                ? tr("7 hari terakhir", "last 7 days")
                : tr("app di depan layar", "apps in front")}
          </span>
        </div>
        {chart}
      </div>
      {size === "xl" && (
        <div className="w-stats-side">
          <div className="w-stats-list">
            <span className="w-stats-head">{tr("App teratas", "Top apps")}</span>
            {tops.apps.length ? (
              tops.apps.map(([exe, a]) => (
                <div key={exe} className="w-stats-row">
                  <AppIcon exe={exe} />
                  <span className="ellipsis">{a.name}</span>
                  <span className="muted tabular">{hm(a.ms)}</span>
                </div>
              ))
            ) : (
              <span className="muted w-stats-none">{tr("Belum ada data", "No data yet")}</span>
            )}
          </div>
          <div className="w-stats-list">
            <span className="w-stats-head">{tr("Lagu teratas", "Top songs")}</span>
            {tops.songs.length ? (
              tops.songs.map((s) => (
                <div key={`${s.title}|${s.artist}`} className="w-stats-row">
                  <Icon name="music" size={13} />
                  <span className="ellipsis" title={`${s.title} · ${s.artist}`}>
                    {s.title}
                  </span>
                  <span className="muted tabular">{s.plays}×</span>
                </div>
              ))
            ) : (
              <span className="muted w-stats-none">{tr("Belum ada data", "No data yet")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
