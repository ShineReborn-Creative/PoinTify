import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { mmss, uid } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useStore } from "../lib/store";
import { setTab } from "../state/island";
import { settingsStore } from "../state/settings";
import { fullDuration, isFresh, pauseTimer, remaining, resetTimer, skipPhase, startTimer, timerStore } from "../state/timer";
import { drink, undoDrink, waterStore } from "../state/water";
import { str, WLabel, WState, type WidgetProps } from "./common";
import { clipStore, initClipboard } from "./data";
import { setCfg } from "./layout";

// ---------------------------------------------------------------------------
// To-do
// ---------------------------------------------------------------------------

type Todo = { id: string; text: string; done: boolean };

function todos(item: WidgetProps["item"]): Todo[] {
  return Array.isArray(item.cfg.items) ? (item.cfg.items as Todo[]) : [];
}

export function TodoWidget({ item, size }: WidgetProps) {
  const list = todos(item);
  const [text, setText] = useState("");
  const left = list.filter((t) => !t.done).length;
  const save = (items: Todo[]) => setCfg(item.id, { items });
  const add = () => {
    const t = text.trim();
    if (!t) return;
    save([...list, { id: uid(), text: t, done: false }]);
    setText("");
  };
  // Yang belum beres di atas.
  const shown = [...list].sort((a, b) => Number(a.done) - Number(b.done)).slice(0, size === "l" ? 6 : 2);
  return (
    <div className="w-todo">
      <WLabel icon="checklist" right={list.length ? `${left} sisa` : undefined}>
        {str(item.cfg.title) || "To-do"}
      </WLabel>
      <div className="w-todo-list">
        {shown.map((t) => (
          <div key={t.id} className={`w-todo-row${t.done ? " done" : ""}`}>
            <button
              className="w-check"
              role="checkbox"
              aria-checked={t.done}
              aria-label={t.text}
              onClick={() => save(list.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
            >
              {t.done && <Icon name="check" size={11} />}
            </button>
            <span className="ellipsis">{t.text}</span>
            <button className="w-row-x" aria-label="Hapus" onClick={() => save(list.filter((x) => x.id !== t.id))}>
              <Icon name="close" size={11} />
            </button>
          </div>
        ))}
      </div>
      <input
        className="w-input"
        value={text}
        placeholder="Tambah tugas, Enter"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        onFocus={() => void api.focusIsland()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catatan
// ---------------------------------------------------------------------------

export const NOTE_COLORS: [string, string][] = [
  ["yellow", "Kuning"],
  ["pink", "Pink"],
  ["blue", "Biru"],
  ["green", "Hijau"],
  ["violet", "Ungu"],
  ["dark", "Gelap"],
];

export function NoteWidget({ item }: WidgetProps) {
  const color = str(item.cfg.color, "yellow");
  const [text, setText] = useState(str(item.cfg.text));
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setText(str(item.cfg.text)), [item.id]);
  return (
    <div className={`w-note note-${color}`}>
      <textarea
        value={text}
        placeholder="Tulis apa aja…"
        spellCheck={false}
        onFocus={() => void api.focusIsland()}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCfg(item.id, { text: v }), 400);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riwayat clipboard
// ---------------------------------------------------------------------------

export function ClipboardWidget({ size }: WidgetProps) {
  const items = useStore(clipStore);
  const [copied, setCopied] = useState<number | null>(null);
  useEffect(() => initClipboard(), []);
  const shown = items.slice(0, size === "l" ? 6 : 2);
  return (
    <div className="w-clip">
      <WLabel
        icon="clipboard"
        right={
          items.length ? (
            <button className="w-link" onClick={() => void api.clipboardClear()}>
              Bersihin
            </button>
          ) : undefined
        }
      >
        Clipboard
      </WLabel>
      {shown.length === 0 ? (
        <WState>Teks yang lu copy muncul di sini. Disimpen sementara aja, hilang pas PoinTify ditutup.</WState>
      ) : (
        <div className="w-clip-list">
          {shown.map((c) => (
            <button
              key={c.at}
              className="w-clip-row"
              title={c.text}
              onClick={() => {
                void api.clipboardCopy(c.text).then(() => {
                  setCopied(c.at);
                  window.setTimeout(() => setCopied(null), 1200);
                });
              }}
            >
              <span className="ellipsis">{c.text.replace(/\s+/g, " ")}</span>
              <span className="w-clip-tag">{copied === c.at ? "Disalin" : <Icon name="copy" size={12} />}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timer fokus & minum (dari Beranda lama)
// ---------------------------------------------------------------------------

const PHASE_SHORT: Record<string, string> = { focus: "Fokus", short: "Istirahat", long: "Istirahat panjang" };

function focusTime(ms: number) {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`;
}

/**
 * Timer fokus: angka gede, isi warna yang nyapu pelan dari kiri ke kanan
 * sesuai waktu yang udah lewat, dan pil sesi yang nunjukin udah fokus berapa
 * kali sebelum istirahat panjang.
 */
export function TimerWidget({ size }: WidgetProps) {
  const timer = useStore(timerStore);
  const settings = useStore(settingsStore);
  const now = useNow(1000, timer.running);
  const left = remaining(timer, now);
  const total = fullDuration(timer);
  const progress = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 0;
  const every = Math.max(2, settings?.sessionsBeforeLongBreak ?? 4);
  const focus = timer.phase === "focus";
  const fresh = isFresh(timer);
  const state = timer.running ? "running" : fresh ? "idle" : "paused";
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timer.running) pauseTimer();
    else startTimer();
  };
  return (
    <div
      className={`w-timer size-${size} phase-${timer.phase} ${state}`}
      style={{ ["--p" as string]: progress }}
      onClick={() => setTab("timer")}
      role="button"
      aria-label="Buka timer fokus"
    >
      <span className="w-timer-fill" aria-hidden="true" />
      <div className="w-timer-top">
        <span className="w-timer-chip">
          <i />
          {state === "paused" ? "Dijeda" : PHASE_SHORT[timer.phase]}
        </span>
        <div className="w-timer-btns">
          {size !== "s" && (
            <>
              <button
                className="w-timer-btn ghost"
                aria-label="Ulang dari awal"
                title="Ulang dari awal"
                disabled={fresh}
                onClick={(e) => {
                  e.stopPropagation();
                  resetTimer();
                }}
              >
                <Icon name="reset" size={13} />
              </button>
              <button
                className="w-timer-btn ghost"
                aria-label="Lewati ke fase berikutnya"
                title="Lewati"
                onClick={(e) => {
                  e.stopPropagation();
                  skipPhase();
                }}
              >
                <Icon name="skip" size={13} />
              </button>
            </>
          )}
          <button className="w-timer-btn main" aria-label={timer.running ? "Jeda timer" : "Mulai timer"} onClick={toggle}>
            <Icon name={timer.running ? "pause" : "play"} size={13} />
          </button>
        </div>
      </div>
      <strong className="w-timer-time tabular">{mmss(left)}</strong>
      <div className="w-timer-foot">
        <span className="w-timer-pips" aria-label={`Sesi ${Math.min(timer.cycleCount + 1, every)} dari ${every}`}>
          {Array.from({ length: every }, (_, i) => {
            const done = i < timer.cycleCount || (!focus && i === timer.cycleCount - 1);
            const current = focus && i === timer.cycleCount;
            return (
              <i key={i} className={done ? "done" : current ? "current" : ""}>
                {current && <b style={{ width: `${progress * 100}%` }} />}
              </i>
            );
          })}
        </span>
        {size !== "s" && (
          <span className="muted w-timer-today">
            Hari ini {timer.todaySessions} sesi · {focusTime(timer.todayFocusMs)}
          </span>
        )}
      </div>
    </div>
  );
}

export function WaterWidget({ size }: WidgetProps) {
  const water = useStore(waterStore);
  const settings = useStore(settingsStore);
  const now = useNow(30_000);
  const goal = settings?.waterGoal ?? 8;
  const minutesLeft = Math.max(0, Math.round((water.nextAt - now) / 60_000));
  return (
    <div className={`w-mini water size-${size}`}>
      <div className="water-glasses" aria-label={`${water.count} dari ${goal} gelas`}>
        {Array.from({ length: Math.min(goal, 12) }, (_, i) => (
          <span key={i} className={i < water.count ? "glass full" : "glass"} />
        ))}
      </div>
      <div className="mini-text">
        <strong>
          {water.count}/{goal}
          {size !== "s" && " gelas"}
        </strong>
        <span className="muted">
          {!settings?.waterEnabled ? "Pengingat mati" : water.count >= goal ? "Target tercapai" : `${minutesLeft} mnt lagi`}
        </span>
      </div>
      <div className="water-buttons">
        <button className="icon-btn" aria-label="Kurangi satu gelas" onClick={undoDrink} disabled={water.count === 0}>
          <Icon name="minus" size={14} />
        </button>
        <button className="icon-btn solid water-add" aria-label="Tambah satu gelas" onClick={drink}>
          <Icon name="drop" size={15} />
        </button>
      </div>
    </div>
  );
}
