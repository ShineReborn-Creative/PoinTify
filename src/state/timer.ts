import { todayKey } from "../lib/format";
import { createStore } from "../lib/store";
import { settingsStore } from "./settings";
import { tr } from "../i18n";

export type Phase = "focus" | "short" | "long";

export type TimerState = {
  phase: Phase;
  running: boolean;
  /** Waktu selesai (ms epoch) selama timer jalan. */
  endsAt: number | null;
  /** Sisa waktu pas timer dijeda. */
  remainingMs: number;
  /** Durasi penuh fase ini pas dimulai (buat tahu timer udah pernah jalan atau belum). */
  fullMs?: number;
  /** Sesi fokus yang udah beres di siklus ini (buat nentuin istirahat panjang). */
  cycleCount: number;
  todaySessions: number;
  todayFocusMs: number;
  day: string;
};

const STORAGE = "pointify.timer.v1";

export const PHASE_LABEL: Record<Phase, string> = {
  get focus() {
    return tr("Fokus", "Focus");
  },
  get short() {
    return tr("Istirahat", "Break");
  },
  get long() {
    return tr("Istirahat panjang", "Long break");
  },
};

export function phaseDuration(phase: Phase): number {
  const s = settingsStore.get();
  const minutes =
    phase === "focus"
      ? s?.focusMinutes ?? 25
      : phase === "short"
        ? s?.shortBreakMinutes ?? 5
        : s?.longBreakMinutes ?? 15;
  return Math.max(1, minutes) * 60_000;
}

function load(): TimerState {
  const fresh: TimerState = {
    phase: "focus",
    running: false,
    endsAt: null,
    remainingMs: 25 * 60_000,
    cycleCount: 0,
    todaySessions: 0,
    todayFocusMs: 0,
    day: todayKey(),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as TimerState | null;
    if (!saved) return fresh;
    const state = { ...fresh, ...saved };
    if (state.day !== todayKey()) {
      state.day = todayKey();
      state.todaySessions = 0;
      state.todayFocusMs = 0;
    }
    return state;
  } catch {
    return fresh;
  }
}

export const timerStore = createStore<TimerState>(load());

timerStore.subscribe(() => {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(timerStore.get()));
  } catch {
    /* localStorage penuh atau diblok: statistik aja yang nggak kesimpen */
  }
});

type CompleteHandler = (finished: Phase, next: Phase) => void;
const completeHandlers = new Set<CompleteHandler>();
export function onTimerComplete(fn: CompleteHandler) {
  completeHandlers.add(fn);
  return () => {
    completeHandlers.delete(fn);
  };
}

export function remaining(state: TimerState, now: number): number {
  if (state.running && state.endsAt) return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

export function startTimer() {
  timerStore.set((s) => ({ ...s, running: true, endsAt: Date.now() + s.remainingMs }));
}

export function pauseTimer() {
  timerStore.set((s) =>
    s.running ? { ...s, running: false, endsAt: null, remainingMs: remaining(s, Date.now()) } : s,
  );
}

export function resetTimer() {
  timerStore.set((s) => ({ ...s, running: false, endsAt: null, remainingMs: phaseDuration(s.phase), fullMs: phaseDuration(s.phase) }));
}

function nextPhase(s: TimerState, countFinished: boolean): { phase: Phase; cycleCount: number } {
  if (s.phase !== "focus") return { phase: "focus", cycleCount: s.cycleCount };
  const cycle = s.cycleCount + (countFinished ? 1 : 0);
  const every = Math.max(2, settingsStore.get()?.sessionsBeforeLongBreak ?? 4);
  if (cycle >= every) return { phase: "long", cycleCount: 0 };
  return { phase: "short", cycleCount: cycle };
}

export function skipPhase() {
  timerStore.set((s) => {
    const { phase, cycleCount } = nextPhase(s, false);
    return { ...s, phase, cycleCount, running: false, endsAt: null, remainingMs: phaseDuration(phase), fullMs: phaseDuration(phase) };
  });
}

export function setPhase(phase: Phase) {
  timerStore.set((s) => ({ ...s, phase, running: false, endsAt: null, remainingMs: phaseDuration(phase), fullMs: phaseDuration(phase) }));
}

/** Dipanggil tiap detik dari jendela notch. */
export function tickTimer(now: number) {
  const s = timerStore.get();
  if (s.day !== todayKey()) {
    timerStore.set({ ...s, day: todayKey(), todaySessions: 0, todayFocusMs: 0 });
  }
  if (!s.running || !s.endsAt || now < s.endsAt) return;

  const finished = s.phase;
  const { phase, cycleCount } = nextPhase(s, finished === "focus");
  const autoStart =
    finished === "focus" ? settingsStore.get()?.autoStartBreaks ?? true : false;
  const duration = phaseDuration(phase);
  timerStore.set({
    ...s,
    phase,
    cycleCount,
    running: autoStart,
    endsAt: autoStart ? now + duration : null,
    remainingMs: duration,
    fullMs: duration,
    todaySessions: s.todaySessions + (finished === "focus" ? 1 : 0),
    todayFocusMs: s.todayFocusMs + (finished === "focus" ? phaseDuration("focus") : 0),
  });
  completeHandlers.forEach((fn) => fn(finished, phase));
}

/** Timer belum pernah dijalanin di fase ini (bukan lagi dijeda di tengah). */
export function isFresh(s: TimerState): boolean {
  if (s.running) return false;
  // Data lama tanpa fullMs: anggap baru kalau sisanya pas menit bulat.
  return s.fullMs !== undefined ? s.remainingMs === s.fullMs : s.remainingMs % 60_000 === 0;
}

/** Durasi penuh fase yang lagi jalan. */
export function fullDuration(s: TimerState): number {
  return s.fullMs ?? phaseDuration(s.phase);
}

/**
 * Kalau durasi di pengaturan berubah dan timer belum dimulai, samain sisa
 * waktunya. Timer yang lagi dijeda di tengah jangan di-reset.
 */
export function syncTimerWithSettings() {
  const s = timerStore.get();
  if (!isFresh(s)) return;
  const full = phaseDuration(s.phase);
  if (s.remainingMs !== full || s.fullMs !== full) timerStore.set({ ...s, remainingMs: full, fullMs: full });
}
