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
import { tr } from "../i18n";

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
      <WLabel icon="checklist" right={list.length ? tr(`${left} sisa`, `${left} left`) : undefined}>
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
            <button className="w-row-x" aria-label={tr("Hapus", "Remove")} onClick={() => save(list.filter((x) => x.id !== t.id))}>
              <Icon name="close" size={11} />
            </button>
          </div>
        ))}
      </div>
      <input
        className="w-input"
        value={text}
        placeholder={tr("Tambah tugas, Enter", "Add a task, Enter")}
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
  ["yellow", tr("Kuning", "Yellow")],
  ["pink", "Pink"],
  ["blue", tr("Biru", "Blue")],
  ["green", tr("Hijau", "Green")],
  ["violet", tr("Ungu", "Purple")],
  ["dark", tr("Gelap", "Dark")],
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
        placeholder={tr("Tulis apa aja…", "Write anything…")}
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
              {tr("Bersihin", "Clear")}
            </button>
          ) : undefined
        }
      >
        Clipboard
      </WLabel>
      {shown.length === 0 ? (
        <WState>{tr("Teks yang lu copy muncul di sini. Disimpen sementara aja, hilang pas PoinTify ditutup.", "Text you copy shows up here. It's only kept temporarily and disappears when PoinTify closes.")}</WState>
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

const PHASE_SHORT: Record<string, string> = {
  focus: tr("Fokus", "Focus"),
  short: tr("Istirahat", "Break"),
  long: tr("Istirahat panjang", "Long break"),
};

function focusTime(ms: number) {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}${tr("j", "h")} ${m % 60}m` : `${m}m`;
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
      aria-label={tr("Buka timer fokus", "Open focus timer")}
    >
      <span className="w-timer-fill" aria-hidden="true" />
      <div className="w-timer-top">
        <span className="w-timer-chip">
          <i />
          {state === "paused" ? tr("Dijeda", "Paused") : PHASE_SHORT[timer.phase]}
        </span>
        <div className="w-timer-btns">
          {size !== "s" && (
            <>
              <button
                className="w-timer-btn ghost"
                aria-label={tr("Ulang dari awal", "Restart")}
                title={tr("Ulang dari awal", "Restart")}
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
                aria-label={tr("Lewati ke fase berikutnya", "Skip to the next phase")}
                title={tr("Lewati", "Skip")}
                onClick={(e) => {
                  e.stopPropagation();
                  skipPhase();
                }}
              >
                <Icon name="skip" size={13} />
              </button>
            </>
          )}
          <button className="w-timer-btn main" aria-label={timer.running ? tr("Jeda timer", "Pause timer") : tr("Mulai timer", "Start timer")} onClick={toggle}>
            <Icon name={timer.running ? "pause" : "play"} size={13} />
          </button>
        </div>
      </div>
      <strong className="w-timer-time tabular">{mmss(left)}</strong>
      <div className="w-timer-foot">
        <span className="w-timer-pips" aria-label={tr(`Sesi ${Math.min(timer.cycleCount + 1, every)} dari ${every}`, `Session ${Math.min(timer.cycleCount + 1, every)} of ${every}`)}>
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
            {tr(`Hari ini ${timer.todaySessions} sesi`, `Today ${timer.todaySessions} ${timer.todaySessions === 1 ? "session" : "sessions"}`)} · {focusTime(timer.todayFocusMs)}
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
    <div className={`w-water size-${size}`}>
      <WLabel
        icon="drop"
        right={
          <>
            <button className="w-water-btn" aria-label={tr("Kurangi satu gelas", "Remove one glass")} onClick={undoDrink} disabled={water.count === 0}>
              <Icon name="minus" size={12} />
            </button>
            <button className="w-water-btn add" aria-label={tr("Tambah satu gelas", "Add one glass")} onClick={drink}>
              <Icon name="plus" size={12} />
            </button>
          </>
        }
      >
        {tr("Minum", "Water")}
      </WLabel>
      <strong className="w-big tabular">
        {water.count}
        <small>
          /{goal}
          {size !== "s" && tr(" gelas", " glasses")}
        </small>
      </strong>
      <div className="w-water-bar" aria-label={tr(`${water.count} dari ${goal} gelas`, `${water.count} of ${goal} glasses`)}>
        {Array.from({ length: Math.min(goal, 16) }, (_, i) => (
          <i key={i} className={i < water.count ? "full" : ""} />
        ))}
      </div>
      <span className="muted">
        {!settings?.waterEnabled ? tr("Pengingat mati", "Reminder off") : water.count >= goal ? tr("Target tercapai 🎉", "Goal reached 🎉") : tr(`Minum lagi ${minutesLeft} mnt`, `Next in ${minutesLeft} min`)}
      </span>
    </div>
  );
}
