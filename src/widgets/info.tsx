import { locale, tr } from "../i18n";
import { useEffect } from "react";
import { Icon, type IconName } from "../components/Icon";
import { api } from "../lib/api";
import { useNow } from "../lib/hooks";
import { duration, str, WLabel, WState, type WidgetProps } from "./common";
import { pipConditionStore, placeKey, resolvePlace, setLive, usePolled } from "./data";

// ---------------------------------------------------------------------------
// Cuaca (Open-Meteo, gratis tanpa API key)
// ---------------------------------------------------------------------------

type Forecast = {
  place: string;
  auto: boolean;
  note?: string;
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    is_day: number;
    precipitation: number;
    cloud_cover: number;
    relative_humidity_2m: number;
  };
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
};

type WInfo = { label: string; icon: IconName; rain: boolean };

function weatherInfo(code: number, day = true): WInfo {
  if (code === 0) return { label: tr("Cerah", "Clear"), icon: day ? "sun" : "moon", rain: false };
  if (code <= 2) return { label: tr("Cerah berawan", "Partly cloudy"), icon: day ? "sun" : "moon", rain: false };
  if (code === 3) return { label: tr("Berawan", "Cloudy"), icon: "cloud", rain: false };
  if (code === 45 || code === 48) return { label: tr("Berkabut", "Foggy"), icon: "cloud", rain: false };
  if (code >= 51 && code <= 57) return { label: tr("Gerimis", "Drizzle"), icon: "rain", rain: true };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: tr("Hujan", "Rain"), icon: "rain", rain: true };
  if (code >= 71 && code <= 77) return { label: tr("Salju", "Snow"), icon: "cloud", rain: false };
  if (code >= 95) return { label: tr("Badai petir", "Thunderstorm"), icon: "storm", rain: true };
  return { label: tr("Berawan", "Cloudy"), icon: "cloud", rain: false };
}

/**
 * Keadaan sekarang. Kode cuaca dari model sering bilang gerimis padahal
 * nggak ada air yang turun, jadi hujan cuma dipercaya kalau curah hujannya
 * beneran ada; selain itu dibaca dari tutupan awan.
 */
export function nowInfo(c: Forecast["current"]): WInfo {
  const day = c.is_day === 1;
  const base = weatherInfo(c.weather_code, day);
  if (!base.rain || c.precipitation >= 0.1) return base;
  if (c.cloud_cover < 25) return { label: tr("Cerah", "Clear"), icon: day ? "sun" : "moon", rain: false };
  if (c.cloud_cover < 65) return { label: tr("Cerah berawan", "Partly cloudy"), icon: day ? "sun" : "moon", rain: false };
  return { label: tr("Berawan", "Cloudy"), icon: "cloud", rain: false };
}

/** "terasa 36°" kalau beda jauh sama suhu asli (lembap/angin). */
function feels(c: Forecast["current"]) {
  const t = Math.round(c.temperature_2m);
  const a = Math.round(c.apparent_temperature);
  if (Math.abs(a - t) < 2) return "";
  return tr(`terasa ${a}°`, `feels like ${a}°`);
}

/** `cfg` null = nggak usah ambil (misalnya suhu di pil lagi dimatiin). */
export function useWeather(cfg: Record<string, unknown> | null) {
  return usePolled<Forecast>(
    cfg ? `weather:${placeKey(cfg)}` : null,
    async () => {
      const p = await resolvePlace(cfg ?? {});
      const f = await api.httpGetJson<Omit<Forecast, "place" | "auto" | "note">>(
        `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
          `&current=temperature_2m,apparent_temperature,weather_code,is_day,precipitation,cloud_cover,relative_humidity_2m` +
          `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`,
      );
      return { ...f, place: p.name, auto: !!p.auto, note: p.note };
    },
    10 * 60_000,
  );
}

const DAY = (iso: string) => new Date(iso).toLocaleDateString(locale(), { weekday: "short" });

function PlaceLabel({ data }: { data: Forecast }) {
  return (
    <WLabel icon={data.auto ? "location" : "cloud"} right={data.note ? <span title={data.note}>⚠</span> : undefined}>
      {data.place}
    </WLabel>
  );
}

export function WeatherWidget({ item, size }: WidgetProps) {
  const { data, error } = useWeather(item.cfg);
  const info = data ? nowInfo(data.current) : null;
  useEffect(() => {
    pipConditionStore.set((c) => (c.rain === !!info?.rain ? c : { ...c, rain: !!info?.rain }));
  }, [info?.rain]);
  if (!data || !info) return <WState error={!!error}>{error ?? tr("Ngecek cuaca…", "Checking the weather…")}</WState>;
  const temp = Math.round(data.current.temperature_2m);
  if (size === "s") {
    return (
      <div className="w-weather-s">
        <PlaceLabel data={data} />
        <div className="w-weather-now">
          <Icon name={info.icon} size={26} />
          <strong className="tabular">{temp}°</strong>
        </div>
        <span className="muted ellipsis" title={info.label}>
          {feels(data.current) ? feels(data.current).charAt(0).toUpperCase() + feels(data.current).slice(1) : info.label}
        </span>
      </div>
    );
  }
  return (
    <div className="w-weather">
      <div className="w-weather-left">
        <PlaceLabel data={data} />
        <div className="w-weather-now">
          <Icon name={info.icon} size={28} />
          <strong className="tabular">{temp}°</strong>
        </div>
        <span className="muted ellipsis">
          {info.label} ·{" "}
          {feels(data.current) || `${Math.round(data.daily.temperature_2m_min[0])}°/${Math.round(data.daily.temperature_2m_max[0])}°`}
        </span>
      </div>
      <div className="w-weather-days">
        {data.daily.time.slice(1, 3).map((t, i) => {
          const d = weatherInfo(data.daily.weather_code[i + 1]);
          return (
            <div key={t} className="w-weather-day" title={d.label}>
              <span className="muted">{DAY(t)}</span>
              <Icon name={d.icon} size={16} />
              <span className="tabular">{Math.round(data.daily.temperature_2m_max[i + 1])}°</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jadwal sholat (Aladhan, metode Kemenag RI)
// ---------------------------------------------------------------------------

const PRAYERS: [string, string][] = [
  ["Fajr", tr("Subuh", "Fajr")],
  ["Dhuhr", tr("Dzuhur", "Dhuhr")],
  ["Asr", tr("Ashar", "Asr")],
  ["Maghrib", "Maghrib"],
  ["Isha", tr("Isya", "Isha")],
];

type Timings = { data: { timings: Record<string, string> } };

function dateKey(d = new Date()) {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

function usePrayer(cfg: Record<string, unknown>) {
  const day = dateKey();
  return usePolled<Timings & { place: string }>(
    `prayer:${placeKey(cfg)}:${day}`,
    async () => {
      const p = await resolvePlace(cfg);
      const t = await api.httpGetJson<Timings>(`https://api.aladhan.com/v1/timings/${day}?latitude=${p.lat}&longitude=${p.lon}&method=20`);
      return { ...t, place: p.name };
    },
    60 * 60_000,
  );
}

function prayerTimes(t: Timings | undefined, now: number) {
  if (!t) return null;
  const base = new Date(now);
  const list = PRAYERS.map(([key, name]) => {
    const [h, m] = (t.data.timings[key] ?? "00:00").split(":").map((x) => parseInt(x, 10));
    const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m).getTime();
    return { key, name, text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, at };
  });
  const next = list.find((p) => p.at > now) ?? { ...list[0], at: list[0].at + 86_400_000 };
  const current = [...list].reverse().find((p) => p.at <= now && now - p.at < 15 * 60_000) ?? null;
  return { list, next, current };
}

export function PrayerWidget({ item, size }: WidgetProps) {
  const now = useNow(1000);
  const { data, error } = usePrayer(item.cfg);
  const p = prayerTimes(data, now);
  if (!p) return <WState error={!!error}>{error ?? tr("Ngambil jadwal sholat…", "Fetching prayer times…")}</WState>;
  if (size === "s") {
    return (
      <div className="w-prayer-s">
        <WLabel icon="moon">{p.current ? tr("Waktunya", "It's time") : tr("Berikutnya", "Next")}</WLabel>
        <strong>{p.current?.name ?? p.next.name}</strong>
        <span className="muted tabular">{p.current ? p.current.text : `${p.next.text} · ${duration(p.next.at - now)}`}</span>
      </div>
    );
  }
  return (
    <div className="w-prayer">
      <WLabel icon="moon" right={<span className="tabular">{p.current ? tr(`Waktunya ${p.current.name}`, `Time for ${p.current.name}`) : tr(`${p.next.name} ${duration(p.next.at - now)} lagi`, `${p.next.name} in ${duration(p.next.at - now)}`)}</span>}>
        {data?.place ?? ""}
      </WLabel>
      <div className="w-prayer-row">
        {p.list.map((x) => (
          <div key={x.key} className={`w-prayer-cell${x.key === (p.current?.key ?? p.next.key) ? " next" : ""}`}>
            <span>{x.name}</span>
            <b className="tabular">{x.text}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PrayerLive({ item }: WidgetProps) {
  const now = useNow(1000);
  const { data } = usePrayer(item.cfg);
  const p = prayerTimes(data, now);
  const soon = p && p.next.at - now <= 15 * 60_000 ? p.next : null;
  const key = p?.current ? `now:${p.current.key}` : soon ? `soon:${soon.key}:${Math.floor((soon.at - now) / 1000)}` : "";
  useEffect(() => {
    if (p?.current) setLive(item.id, { priority: 8, icon: "moon", label: tr("Waktunya", "It's time"), value: p.current.name, tone: "accent" });
    else if (soon) setLive(item.id, { priority: 7, icon: "moon", label: soon.name, value: duration(soon.at - now), tone: "accent" });
    else setLive(item.id, null);
  }, [item.id, key]);
  useEffect(() => () => setLive(item.id, null), [item.id]);
  return null;
}

// ---------------------------------------------------------------------------
// Kurs (Frankfurter, kurs referensi ECB)
// ---------------------------------------------------------------------------

export const CURRENCIES = ["USD", "EUR", "SGD", "JPY", "CNY", "AUD", "GBP", "MYR", "KRW", "IDR"];

export function CurrencyWidget({ item }: WidgetProps) {
  const base = str(item.cfg.base, "USD");
  const quote = str(item.cfg.quote, "IDR");
  const { data, error } = usePolled<{ rates: Record<string, number>; date: string }>(
    base === quote ? null : `fx:${base}:${quote}`,
    () => api.httpGetJson(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`),
    60 * 60_000,
  );
  const rate = data?.rates?.[quote];
  return (
    <div className="w-fx">
      <WLabel icon="money">
        {base} → {quote}
      </WLabel>
      {base === quote ? (
        <WState>{tr("Pilih dua mata uang yang beda.", "Pick two different currencies.")}</WState>
      ) : rate ? (
        <>
          <strong className="w-big tabular">{rate.toLocaleString(locale(), { maximumFractionDigits: rate < 10 ? 4 : 0 })}</strong>
          <span className="muted">1 {base} · {new Date(data.date).toLocaleDateString(locale(), { day: "numeric", month: "short" })}</span>
        </>
      ) : (
        <WState error={!!error}>{error ?? tr("Ngambil kurs…", "Fetching rates…")}</WState>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub (API publik)
// ---------------------------------------------------------------------------

type Gh = {
  stars: number;
  forks: number;
  issues: number;
  commit?: { message: string; date: string };
  release?: string;
};

function ago(iso: string, now: number) {
  const ms = now - Date.parse(iso);
  if (ms < 3_600_000) return tr(`${Math.max(1, Math.round(ms / 60_000))} mnt lalu`, `${Math.max(1, Math.round(ms / 60_000))} min ago`);
  if (ms < 86_400_000) return tr(`${Math.round(ms / 3_600_000)} jam lalu`, `${Math.round(ms / 3_600_000)}h ago`);
  return tr(`${Math.round(ms / 86_400_000)} hari lalu`, `${Math.round(ms / 86_400_000)}d ago`);
}

export function GithubWidget({ item }: WidgetProps) {
  const repo = str(item.cfg.repo, "ShineReborn-Creative/PoinTify").trim();
  const now = useNow(60_000);
  const { data, error } = usePolled<Gh>(
    repo.includes("/") ? `gh:${repo}` : null,
    async () => {
      const base = `https://api.github.com/repos/${repo}`;
      type Repo = { stargazers_count: number; forks_count: number; open_issues_count: number };
      type Commit = { commit: { message: string; author: { date: string } } }[];
      const [r, c, rel] = await Promise.all([
        api.httpGetJson<Repo>(base),
        api.httpGetJson<Commit>(`${base}/commits?per_page=1`).catch(() => [] as Commit),
        api.httpGetJson<{ tag_name: string }>(`${base}/releases/latest`).catch(() => null),
      ]);
      return {
        stars: r.stargazers_count,
        forks: r.forks_count,
        issues: r.open_issues_count,
        commit: c[0] ? { message: c[0].commit.message.split("\n")[0], date: c[0].commit.author.date } : undefined,
        release: rel?.tag_name,
      };
    },
    15 * 60_000,
  );
  return (
    <div className="w-gh">
      <WLabel icon="code" right={data?.release}>
        {repo.split("/").pop() || "Repo"}
      </WLabel>
      {data ? (
        <>
          <div className="w-gh-stats">
            <span>
              <Icon name="star" size={13} /> <b className="tabular">{data.stars}</b>
            </span>
            <span>
              <Icon name="commit" size={13} /> <b className="tabular">{data.forks}</b> {tr("fork", "forks")}
            </span>
            <span>
              <Icon name="info" size={13} /> <b className="tabular">{data.issues}</b> {tr("isu", "issues")}
            </span>
          </div>
          {data.commit && (
            <div className="w-gh-commit">
              <span className="ellipsis">{data.commit.message}</span>
              <span className="muted">{ago(data.commit.date, now)}</span>
            </div>
          )}
        </>
      ) : (
        <WState error={!!error}>{error ?? tr("Ngambil data repo…", "Fetching repo data…")}</WState>
      )}
    </div>
  );
}
