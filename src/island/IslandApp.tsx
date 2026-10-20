import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PipMood } from "../components/Pip";
import { play } from "../lib/sound";
import { useStore } from "../lib/store";
import { chatStore, onClaudeFinished } from "../state/chat";
import {
  blurGuard,
  collapse,
  dismissPeek,
  expand,
  islandStore,
  pin,
  reportHit,
  setFileOver,
  setHover,
  setVisible,
  showPeek,
  SIZES,
} from "../state/island";
import { mediaStore } from "../state/media";
import { settingsStore } from "../state/settings";
import { addToShelf } from "../state/shelf";
import { onTimerComplete, PHASE_LABEL, syncTimerWithSettings, tickTimer, timerStore } from "../state/timer";
import { drink, snoozeWater, waterDue, waterStore } from "../state/water";
import { CompactBar } from "./CompactBar";
import { ExpandedView } from "./ExpandedView";
import { PeekCard } from "./PeekCard";

export function IslandApp() {
  const island = useStore(islandStore);
  const media = useStore(mediaStore);
  const timer = useStore(timerStore);
  const chat = useStore(chatStore);
  const settings = useStore(settingsStore);

  const [flash, setFlash] = useState<PipMood | null>("wave");
  const [lastActive, setLastActive] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const flashTimer = useRef<number | undefined>(undefined);

  const flashMood = (mood: PipMood, ms = 2600) => {
    setFlash(mood);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  };

  // Sapaan pas baru dibuka.
  useEffect(() => {
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
    if (!localStorage.getItem("pointify.welcomed")) {
      localStorage.setItem("pointify.welcomed", "1");
      showPeek({
        kind: "info",
        title: "Halo, gue Pip!",
        body: "Arahin kursor ke sini buat buka PoinTify.",
        mood: "wave",
        timeoutMs: 6000,
      });
    }
  }, []);

  // ---- Hover dari Rust, buka/tutup dengan jeda kecil ----
  useEffect(() => {
    let openTimer: number | undefined;
    let closeTimer: number | undefined;
    const unlisten = listen<boolean>("island-hover", (e) => {
      const inside = e.payload;
      const s = islandStore.get();
      const cfg = settingsStore.get();
      setHover(inside);
      window.clearTimeout(openTimer);
      window.clearTimeout(closeTimer);
      if (inside) {
        setLastActive(Date.now());
        if (s.mode === "compact" && (cfg?.openOnHover ?? true)) {
          openTimer = window.setTimeout(() => {
            if (islandStore.get().hover) expand();
          }, cfg?.hoverDelayMs ?? 120);
        }
      } else if (s.mode === "expanded" && !s.pinned && !s.fileOver) {
        closeTimer = window.setTimeout(() => {
          const now = islandStore.get();
          if (!now.hover && !now.pinned && !now.fileOver) collapse();
        }, 380);
      }
    });
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(closeTimer);
      void unlisten.then((f) => f());
    };
  }, []);

  // ---- Event lain dari Rust: tray, shortcut, app fullscreen ----
  useEffect(() => {
    const subs = [
      listen<string>("island-open", () => expand("home")),
      listen("island-toggle-chat", () => {
        const s = islandStore.get();
        if (s.mode === "expanded" && s.tab === "chat") {
          collapse();
        } else {
          expand("chat");
          pin(true);
          window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 80);
        }
      }),
      listen<boolean>("island-visibility", (e) => setVisible(e.payload)),
    ];
    return () => subs.forEach((p) => void p.then((f) => f()));
  }, []);

  // ---- Drag file ke notch ----
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter") {
        setFileOver(true);
        expand("shelf");
      } else if (p.type === "drop") {
        setFileOver(false);
        if (p.paths.length) {
          void addToShelf(p.paths);
          play("drop");
          flashMood("happy");
        }
        pin(true);
      } else if (p.type === "leave") {
        setFileOver(false);
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // ---- Fokus jendela: klik di luar = tutup ----
  useEffect(() => {
    const onBlur = () => {
      if (Date.now() < blurGuard.until) return;
      const s = islandStore.get();
      if (s.mode === "expanded" && !s.hover) collapse();
      else if (s.mode === "expanded") pin(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ---- Detak 1 detik: timer & pengingat minum ----
  useEffect(() => {
    let waterNotified = false;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      tickTimer(t);
      if (waterDue(t)) {
        if (!waterNotified) {
          waterNotified = true;
          play("drop");
          const w = waterStore.get();
          const goal = settingsStore.get()?.waterGoal ?? 8;
          showPeek({
            kind: "water",
            title: "Waktunya minum",
            body: `Udah ${w.count} dari ${goal} gelas hari ini.`,
            mood: "notify",
            actions: [
              { label: "Nanti", run: () => { snoozeWater(10); dismissPeek(); } },
              { label: "Udah minum", primary: true, run: () => { drink(); dismissPeek(); flashMood("happy"); } },
            ],
          });
        }
      } else {
        waterNotified = false;
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // ---- Timer selesai ----
  useEffect(
    () =>
      onTimerComplete((finished, next) => {
        play(finished === "focus" ? "done" : "chime");
        flashMood("happy", 3500);
        const auto = timerStore.get().running;
        showPeek({
          kind: "timer",
          title: finished === "focus" ? "Sesi fokus beres!" : "Istirahat selesai",
          body:
            finished === "focus"
              ? auto
                ? `${PHASE_LABEL[next]} dimulai. Regangin badan dulu.`
                : `Lanjut ${PHASE_LABEL[next].toLowerCase()}?`
              : "Siap fokus lagi?",
          mood: "happy",
          openTab: "timer",
          timeoutMs: 9000,
        });
      }),
    [],
  );

  // ---- Claude selesai jawab ----
  useEffect(
    () =>
      onClaudeFinished((ok, summary) => {
        play(ok ? "done" : "error");
        flashMood(ok ? "happy" : "error", 3000);
        const s = islandStore.get();
        if (s.mode === "expanded" && s.tab === "chat") return;
        showPeek({
          kind: "claude",
          title: ok ? "Claude udah jawab" : "Claude ketemu masalah",
          body: summary.replace(/\s+/g, " ").slice(0, 90) || undefined,
          mood: ok ? "happy" : "error",
          openTab: "chat",
          timeoutMs: 10000,
        });
      }),
    [],
  );

  // Durasi di pengaturan berubah -> sesuaikan timer yang lagi diam.
  useEffect(() => {
    syncTimerWithSettings();
  }, [settings?.focusMinutes, settings?.shortBreakMinutes, settings?.longBreakMinutes]);

  // ---- Ukuran pulau ----
  const activity: "claude" | "timer" | "music" | null = chat.running
    ? "claude"
    : timer.running
      ? "timer"
      : media?.isPlaying
        ? "music"
        : null;

  const size = useMemo(() => {
    if (island.mode === "expanded") return SIZES.expanded[island.tab];
    if (island.mode === "peek") return SIZES.peek;
    return activity ? SIZES.compactWide : SIZES.compactBase;
  }, [island.mode, island.tab, activity]);

  useEffect(() => {
    reportHit(size.w, size.h);
  }, [size.w, size.h]);

  // ---- Suasana hati Pip ----
  const idleLong = !island.hover && !activity && now - lastActive > 3 * 60_000;
  const mood: PipMood = island.fileOver
    ? "listening"
    : flash
      ? flash
      : island.mode === "peek" && island.peek
        ? island.peek.mood
        : chat.running
          ? chat.lastActivity === "working"
            ? "working"
            : "thinking"
          : media?.isPlaying
            ? "music"
            : idleLong
              ? "sleep"
              : "idle";

  useEffect(() => {
    if (activity) setLastActive(Date.now());
  }, [activity]);

  if (!settings) return null;

  return (
    <div className="stage">
      <div className="island-shell" style={{ width: size.w, height: size.h }}>
        <span className="shoulder left" />
        <span className="shoulder right" />
        <div
          className={`island mode-${island.mode}${island.fileOver ? " file-over" : ""}`}
          onMouseDown={() => {
            if (islandStore.get().mode === "expanded") pin(true);
          }}
          onClick={() => {
            if (islandStore.get().mode === "compact") expand();
          }}
        >
          {island.mode === "compact" && <CompactBar mood={mood} activity={activity} />}
          {island.mode === "peek" && island.peek && <PeekCard peek={island.peek} mood={mood} />}
          {island.mode === "expanded" && <ExpandedView mood={mood} />}
        </div>
      </div>
    </div>
  );
}
