import { Pip, type PipMood } from "../components/Pip";
import { compactPip } from "../state/islandDrag";
import { dragPipOut } from "../state/pet";
import { settingsStore } from "../state/settings";
import { Ring } from "../components/Ring";
import { mmss } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useStore } from "../lib/store";
import { toolLabel } from "../lib/tools";
import { activeSession, agentsStore } from "../state/agents";
import { chatStore } from "../state/chat";
import { activeLyricIndex, lyricsStore, mediaStore, positionAt } from "../state/media";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { foregroundStore } from "../state/foreground";
import { fullDuration, PHASE_LABEL, remaining, timerStore } from "../state/timer";
import { hhmm } from "../widgets/common";
import { bytes, speed as speedText, useSysStats } from "../widgets/data";
import { downloadsStore } from "../state/downloads";
import { nowInfo, useWeather } from "../widgets/info";
import { widgetStore } from "../widgets/layout";
import type { LiveInfo } from "../widgets/data";
import { LiveActivity } from "../widgets/live";
import { tr } from "../i18n";

/** "ambient" = lagi sepi: logo app, CPU, RAM, jam, suhu gantian. */
export type Activity = "claude" | "agent" | "download" | "live" | "music" | "ambient" | null;

type Props = { mood: PipMood; activity: Activity; live?: LiveInfo | null; lyrics?: boolean };

/** Notch dalam keadaan kecil: Pip di kiri, kegiatan yang lagi jalan di kanan. */
export function CompactBar({ mood, activity, live, lyrics }: Props) {
  return (
    <div className="compact fade-in">
      <CompactPip mood={mood} />
      {lyrics && <CompactLyric />}
      <div className="compact-right">
        {activity === "claude" && <ClaudeActivity />}
        {activity === "agent" && <AgentActivity />}
        {activity === "download" && <DownloadActivity />}
        {activity === "live" && live && <LiveActivity info={live} />}
        {activity === "music" && <MusicActivity />}
        {activity === "ambient" && <Ambient live={live} />}
        <TimerMini />
      </div>
    </div>
  );
}

function ClaudeActivity() {
  const chat = useStore(chatStore);
  const tool = [...chat.live].reverse().find((s) => s.kind === "tool");
  return (
    <span className="compact-label">
      {chat.lastActivity === "working" && tool?.kind === "tool" ? `Claude: ${tool.name}` : tr("Claude lagi mikir", "Claude is thinking")}
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Pip di notch kecil. Bisa diseret keluar jadi Pip desktop; kalau lagi di desktop, tempatnya kosong. */
function CompactPip({ mood }: { mood: PipMood }) {
  const settings = useStore(settingsStore);
  if (settings?.petMode) return <span className="compact-pip-away" title={tr("Pip lagi di desktop", "Pip is on the desktop")} />;
  return <Pip mood={mood} size={24} onDragOut={dragPipOut} onEngine={(e) => (compactPip.engine = e)} />;
}

/** Sesi Claude Code di terminal: nama project + langkah terakhir. */
function AgentActivity() {
  const agents = useStore(agentsStore);
  const s = activeSession(agents);
  if (!s) return null;
  if (s.source === "chat") {
    const tasks = s.steps.filter((x) => x.kind === "task" || x.kind === "todo");
    const done = tasks.filter((x) => x.kind === "task" && x.ok !== null).length;
    const active = tasks.find((x) => x.kind === "task" && x.ok === null);
    return (
      <span className="compact-label">
        <span className="compact-project">Claude</span>
        <span className="ellipsis">{active?.detail ?? s.title ?? s.project}</span>
        {tasks.length > 0 && <span className="compact-count tabular">{`${done}/${tasks.length}`}</span>}
      </span>
    );
  }
  const step = [...s.steps].reverse().find((x) => x.kind === "tool");
  const what = step ? `${toolLabel(step.tool ?? "")} ${step.detail}`.trim() : tr("lagi mikir", "thinking");
  return (
    <span className="compact-label" title={`${s.project}: ${what}`}>
      <span className="compact-project">{s.project}</span>
      <span className="ellipsis">{what}</span>
      {step && (step.added != null || step.removed != null) && (
        <span className="step-diff tabular">
          {step.added != null && <span className="plus">+{step.added}</span>}
          {step.removed != null && <span className="minus">−{step.removed}</span>}
        </span>
      )}
    </span>
  );
}

/** Download yang lagi jalan: nama file, ukuran yang udah masuk, kecepatan. */
function DownloadActivity() {
  const list = useStore(downloadsStore);
  if (!list.length) return null;
  const speed = list.reduce((s, d) => s + d.speed, 0);
  const one = list.length === 1 ? list[0] : null;
  const title = list.map((d) => `${d.name} · ${bytes(d.bytes)}`).join("\n");
  return (
    <span className="compact-label compact-download" title={title}>
      <span className="download-arrow" aria-hidden="true">
        <Icon name="arrowDown" size={13} />
      </span>
      <span className="ellipsis">{one ? one.name : tr(`${list.length} download`, `${list.length} downloads`)}</span>
      <span className="muted tabular">{speed > 0 ? speedText(speed) : bytes(list.reduce((s, d) => s + d.bytes, 0))}</span>
    </span>
  );
}

/** Timer fokus yang lagi jalan: cukup lingkaran kecil di pojok kanan. Arahin kursor buat liat sisa waktunya. */
function TimerMini() {
  const timer = useStore(timerStore);
  const now = useNow(1000, timer.running);
  if (!timer.running) return null;
  const left = remaining(timer, now);
  const total = fullDuration(timer);
  const label = `${PHASE_LABEL[timer.phase]} · ${mmss(left)}`;
  return (
    <span className="compact-timer-mini" title={label} aria-label={label}>
      <Ring size={17} stroke={2.4} progress={1 - left / total} color={timer.phase === "focus" ? "var(--accent)" : "var(--green)"}>
        <Icon name="timer" size={9} />
      </Ring>
    </span>
  );
}

const ROTATE_MS = 4000;

/**
 * Pas lagi sepi: info gantian tiap beberapa detik. Logo app yang lagi lu
 * pake, CPU, RAM, jam, suhu (cuaca + CPU kalau kebaca), plus Live santai.
 */
function Ambient({ live }: { live?: LiveInfo | null }) {
  const fg = useStore(foregroundStore);
  const { data: sys } = useSysStats(3000);
  const layout = useStore(widgetStore);
  const wcfg = useMemo(() => layout.items.find((i) => i.type === "weather")?.cfg ?? {}, [layout]);
  const { data: weather } = useWeather(wcfg);
  const now = useNow(1000);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);
  // Pindah app: langsung tunjukin logonya.
  useEffect(() => setTick(0), [fg?.exe]);

  const slides: { key: string; node: ReactNode }[] = [];
  if (fg) {
    slides.push({
      key: `app:${fg.exe}`,
      node: (
        <>
          {fg.icon ? <img className="ambient-app-icon" src={fg.icon} alt="" /> : <Icon name="desktop" size={14} />}
          <span className="ellipsis">{fg.name}</span>
        </>
      ),
    });
  }
  if (sys) {
    slides.push({
      key: "cpu",
      node: (
        <>
          <Icon name="cpu" size={13} />
          <span className="ambient-k">CPU</span>
          <b className="tabular">{Math.round(sys.cpu)}%</b>
        </>
      ),
    });
    slides.push({
      key: "ram",
      node: (
        <>
          <Icon name="grid" size={13} />
          <span className="ambient-k">RAM</span>
          <b className="tabular">{Math.round((sys.memUsed / Math.max(1, sys.memTotal)) * 100)}%</b>
        </>
      ),
    });
  }
  slides.push({
    key: "clock",
    node: (
      <>
        <Icon name="clock" size={13} />
        <b className="tabular">{hhmm(new Date(now))}</b>
      </>
    ),
  });
  const cpuTemp = sys?.cpuTemp != null ? Math.round(sys.cpuTemp) : null;
  if (weather || cpuTemp != null) {
    const w = weather ? nowInfo(weather.current) : null;
    slides.push({
      key: "temp",
      node: (
        <>
          <Icon name={w?.icon ?? "cpu"} size={13} />
          {weather && <b className="tabular">{Math.round(weather.current.temperature_2m)}°</b>}
          {cpuTemp != null && <span className={weather ? "ambient-k" : ""}>{weather ? `· CPU ${cpuTemp}°` : `CPU ${cpuTemp}°`}</span>}
        </>
      ),
    });
  }
  if (live) slides.push({ key: `live:${live.label}`, node: <LiveActivity info={live} /> });

  const slide = slides[tick % slides.length];
  return (
    <span className="ambient">
      <span key={slide.key} className="ambient-slide">
        {slide.node}
      </span>
    </span>
  );
}

/** Baris lirik yang lagi dinyanyiin, di tengah pil. Ganti baris = geser naik pelan. */
function CompactLyric() {
  const media = useStore(mediaStore);
  const lyrics = useStore(lyricsStore);
  const settings = useStore(settingsStore);
  const now = useNow(200, !!media?.isPlaying);
  if (!media) return null;
  const idx = activeLyricIndex(lyrics.lines, positionAt(media, now) + (settings?.lyricOffsetMs ?? 0));
  const text = idx >= 0 ? lyrics.lines[idx].text.trim() : "";
  return (
    <div className="compact-lyric" aria-live="off">
      <span key={idx} className={`compact-lyric-line${text ? "" : " rest"}`} title={text || undefined}>
        {text || "♪"}
      </span>
    </div>
  );
}

function MusicActivity() {
  const media = useStore(mediaStore);
  if (!media) return null;
  return (
    <span className="compact-music">
      {media.thumbnail && <img src={media.thumbnail} alt="" />}
      {media.kind === "video" ? (
        <span className="compact-popcorn" role="img" aria-label={tr("Lagi nonton", "Watching")}>
          🍿
        </span>
      ) : (
        <span className="bars playing" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}
