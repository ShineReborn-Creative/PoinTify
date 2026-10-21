import { Icon } from "../../components/Icon";
import { Ring } from "../../components/Ring";
import { mmss } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { useStore } from "../../lib/store";
import { settingsStore } from "../../state/settings";
import {
  PHASE_LABEL,
  pauseTimer,
  fullDuration,
  remaining,
  resetTimer,
  setPhase,
  skipPhase,
  startTimer,
  timerStore,
  type Phase,
} from "../../state/timer";
import { tr } from "../../i18n";

const PHASES: Phase[] = ["focus", "short", "long"];

export function TimerTab() {
  const timer = useStore(timerStore);
  const settings = useStore(settingsStore);
  const now = useNow(1000, timer.running);
  const left = remaining(timer, now);
  const total = fullDuration(timer);
  const every = Math.max(2, settings?.sessionsBeforeLongBreak ?? 4);
  const focusMinutesToday = Math.round(timer.todayFocusMs / 60_000);
  const color = timer.phase === "focus" ? "var(--accent)" : "var(--green)";

  return (
    <div className="timer-tab">
      <Ring size={168} stroke={7} progress={1 - left / total} color={color}>
        <div className="timer-face">
          <span className="timer-time tabular">{mmss(left)}</span>
          <span className="muted">{timer.running ? PHASE_LABEL[timer.phase] : tr("Dijeda", "Paused")}</span>
        </div>
      </Ring>

      <div className="timer-side">
        <div className="segmented" role="tablist" aria-label={tr("Jenis sesi", "Session type")}>
          {PHASES.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={timer.phase === p}
              className={timer.phase === p ? "active" : ""}
              onClick={() => setPhase(p)}
            >
              {PHASE_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="timer-controls">
          <button className="icon-btn" aria-label={tr("Ulangi dari awal", "Restart")} title={tr("Ulangi", "Restart")} onClick={resetTimer}>
            <Icon name="reset" size={18} />
          </button>
          <button
            className="play-btn big"
            aria-label={timer.running ? tr("Jeda", "Pause") : tr("Mulai", "Start")}
            onClick={() => (timer.running ? pauseTimer() : startTimer())}
          >
            <Icon name={timer.running ? "pause" : "play"} size={22} />
          </button>
          <button className="icon-btn" aria-label={tr("Lewati sesi ini", "Skip this session")} title={tr("Lewati", "Skip")} onClick={skipPhase}>
            <Icon name="skip" size={18} />
          </button>
        </div>

        <div className="cycle" aria-label={tr(`Sesi ${timer.cycleCount} dari ${every} sebelum istirahat panjang`, `Session ${timer.cycleCount} of ${every} before a long break`)}>
          {Array.from({ length: every }, (_, i) => (
            <span key={i} className={i < timer.cycleCount ? "cycle-dot done" : "cycle-dot"} />
          ))}
          <span className="muted">{tr("sebelum istirahat panjang", "before a long break")}</span>
        </div>

        <p className="timer-stats">
          {tr("Hari ini", "Today")} <strong>{timer.todaySessions} {tr("sesi", timer.todaySessions === 1 ? "session" : "sessions")}</strong> ·{" "}
          <strong>
            {focusMinutesToday} {tr("menit", "min")}
          </strong>{" "}
          {tr("fokus", "focused")}
        </p>
      </div>
    </div>
  );
}
