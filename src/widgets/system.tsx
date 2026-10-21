import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Ring } from "../components/Ring";
import { api, type SysStats } from "../lib/api";
import { useStore } from "../lib/store";
import { quietStore, setQuiet } from "../state/quiet";
import { Meter, WLabel, WState, type WidgetProps } from "./common";
import { bytes, setLive, speed, useSysStats } from "./data";

const pct = (a: number, b: number) => (b > 0 ? a / b : 0);

type Slide = { key: string; label: string; value: number; text: string; sub: string; color: string };

const ROTATE_MS = 3500;

/** Mode kecil: satu angka gede yang gantian CPU → RAM → Baterai. Klik buat lompat. */
function SystemSmall({ data }: { data: SysStats }) {
  const slides: Slide[] = [
    {
      key: "cpu",
      label: "CPU",
      value: data.cpu / 100,
      text: `${Math.round(data.cpu)}`,
      sub: data.cpu >= 85 ? "Panas" : data.cpu >= 50 ? "Sibuk" : "Santai",
      color: data.cpu >= 85 ? "var(--red)" : "var(--accent)",
    },
    {
      key: "ram",
      label: "RAM",
      value: pct(data.memUsed, data.memTotal),
      text: `${Math.round(pct(data.memUsed, data.memTotal) * 100)}`,
      sub: `${Math.round(data.memUsed / 1e9)}/${Math.round(data.memTotal / 1e9)} GB`,
      color: pct(data.memUsed, data.memTotal) >= 0.9 ? "var(--red)" : "var(--blue)",
    },
  ];
  if (data.battery) {
    const b = data.battery;
    slides.push({
      key: "bat",
      label: "Baterai",
      value: b.percent / 100,
      text: `${b.percent}`,
      sub: b.charging ? "Ngecas" : b.percent <= 15 ? "Mau habis" : "Aman",
      color: b.charging ? "var(--green)" : b.percent <= 15 ? "var(--red)" : b.percent <= 30 ? "var(--amber)" : "var(--green)",
    });
  }
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold) return;
    const t = window.setInterval(() => setI((x) => x + 1), ROTATE_MS);
    return () => window.clearInterval(t);
  }, [hold, slides.length]);
  const idx = i % slides.length;
  const cur = slides[idx];
  return (
    <div
      className="w-sys-s"
      role="button"
      title="Klik buat ganti"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onClick={() => setI((x) => x + 1)}
    >
      <Ring size={52} stroke={5} progress={cur.value} color={cur.color}>
        <span key={cur.key} className="w-ring-num tabular w-sys-swap">
          {cur.text}
          <small>%</small>
        </span>
      </Ring>
      <div className="w-sys-s-text">
        <b key={cur.key} className="w-sys-swap">
          {cur.label}
        </b>
        <span key={`${cur.key}-sub`} className="muted w-sys-swap">
          {cur.sub}
        </span>
        <span className="w-sys-dots" aria-hidden="true">
          {slides.map((sl, n) => (
            <i key={sl.key} className={n === idx ? "on" : ""} />
          ))}
        </span>
      </div>
    </div>
  );
}

export function SystemWidget({ size }: WidgetProps) {
  const { data, error } = useSysStats();
  if (!data) return <WState error={!!error}>{error ? "Data sistem nggak kebaca" : "Ngecek sistem…"}</WState>;
  const ram = pct(data.memUsed, data.memTotal);
  const disk = 1 - pct(data.diskFree, data.diskTotal);
  if (size === "s") return <SystemSmall data={data} />;
  const rows: [string, number, string][] = [
    ["CPU", data.cpu / 100, `${Math.round(data.cpu)}%`],
    ["RAM", ram, `${bytes(data.memUsed)} / ${bytes(data.memTotal)}`],
    ["Disk C", disk, `sisa ${bytes(data.diskFree)}`],
  ];
  if (data.battery) rows.push(["Baterai", data.battery.percent / 100, `${data.battery.percent}%${data.battery.charging ? " · ngecas" : ""}`]);
  return (
    <div className="w-sys">
      {rows.slice(0, 4).map(([label, v, text]) => {
        const warn = label === "Baterai" ? v <= 0.15 && !data.battery?.charging : v >= 0.9;
        return (
          <div className="w-sys-row" key={label}>
            <span className="w-sys-label">{label}</span>
            <Meter value={v} tone={warn ? "warn" : label === "Baterai" && data.battery?.charging ? "good" : undefined} />
            <span className="w-sys-val tabular muted">{text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ngelapor ke notch kecil kalau ada yang perlu diperhatiin. */
export function SystemLive({ item }: WidgetProps) {
  const { data } = useSysStats(4000);
  const info = data ? systemAlert(data) : null;
  useEffect(() => setLive(item.id, info), [item.id, info?.label, info?.value]);
  useEffect(() => () => setLive(item.id, null), [item.id]);
  return null;
}

function systemAlert(d: SysStats) {
  if (d.battery && !d.battery.charging && d.battery.percent <= 15) {
    return { priority: 5, icon: "battery", label: "Baterai", value: `${d.battery.percent}%`, tone: "warn" as const };
  }
  if (d.cpu >= 90) return { priority: 4, icon: "cpu", label: "CPU", value: `${Math.round(d.cpu)}%`, tone: "warn" as const };
  if (d.memTotal > 0 && d.memUsed / d.memTotal >= 0.93) {
    return { priority: 3, icon: "cpu", label: "RAM", value: `${Math.round((d.memUsed / d.memTotal) * 100)}%`, tone: "warn" as const };
  }
  if (d.diskTotal > 0 && d.diskFree < 5e9) return { priority: 2, icon: "file", label: "Disk C sisa", value: bytes(d.diskFree), tone: "warn" as const };
  return null;
}

export function NetworkWidget({ size }: WidgetProps) {
  const { data } = useSysStats();
  return (
    <div className={`w-net size-${size}`}>
      <WLabel icon="wifi">Internet</WLabel>
      <div className="w-net-rows">
        <span>
          <Icon name="arrowDown" size={13} />
          <b className="tabular">{data ? speed(data.netDown) : "…"}</b>
        </span>
        <span>
          <Icon name="arrowUp" size={13} />
          <b className="tabular">{data ? speed(data.netUp) : "…"}</b>
        </span>
      </div>
    </div>
  );
}

export function TogglesWidget() {
  const [mic, setMic] = useState<boolean | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const quiet = useStore(quietStore);
  useEffect(() => {
    void api.sysMic(false).then(setMic).catch((e) => setMicError(String(e)));
  }, []);
  const toggleMic = () =>
    void api
      .sysMic(true)
      .then((m) => {
        setMic(m);
        setMicError(null);
      })
      .catch((e) => setMicError(String(e)));
  return (
    <div className="w-toggles">
      <button className="w-tog" aria-label="Kecilin volume" onClick={() => void api.sysMediaKey("volumeDown")}>
        <Icon name="minus" size={16} />
        <span>Vol</span>
      </button>
      <button className="w-tog" aria-label="Bisuin suara" onClick={() => void api.sysMediaKey("mute")}>
        <Icon name="volumeOff" size={16} />
        <span>Mute</span>
      </button>
      <button className="w-tog" aria-label="Gedein volume" onClick={() => void api.sysMediaKey("volumeUp")}>
        <Icon name="plus" size={16} />
        <span>Vol</span>
      </button>
      <button
        className={`w-tog${mic ? " on warn" : ""}`}
        aria-pressed={!!mic}
        aria-label={mic ? "Nyalain mic" : "Bisuin mic"}
        title={micError ?? (mic ? "Mic lagi dibisuin" : "Mic nyala")}
        disabled={mic === null && !!micError}
        onClick={toggleMic}
      >
        <Icon name={mic ? "micOff" : "mic"} size={16} />
        <span>Mic</span>
      </button>
      <button
        className={`w-tog${quiet ? " on" : ""}`}
        aria-pressed={quiet}
        title={quiet ? "Mode tenang nyala: notif dan suara PoinTify diem" : "Mode tenang"}
        onClick={() => setQuiet(!quiet)}
      >
        <Icon name={quiet ? "bellOff" : "bell"} size={16} />
        <span>Tenang</span>
      </button>
    </div>
  );
}
