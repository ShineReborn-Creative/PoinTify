import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PipMood } from "../components/Pip";
import { play } from "../lib/sound";
import { useStore } from "../lib/store";
import { activeSession, agentsStore, onAgentAttention, onAgentFinished } from "../state/agents";
import { chatStore, onClaudeFinished } from "../state/chat";
import {
  blurGuard,
  clampOffset,
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
import { lyricsStore, mediaStore, trackKey } from "../state/media";
import { petDrag } from "../state/pet";
import { settingsStore } from "../state/settings";
import { addToShelf } from "../state/shelf";
import { onTimerComplete, PHASE_LABEL, syncTimerWithSettings, tickTimer, timerStore } from "../state/timer";
import { drink, snoozeWater, waterDue, waterStore } from "../state/water";
import { ApprovalCard, approvalSize } from "./ApprovalCard";
import { useIslandDrag } from "./useIslandDrag";
import { CompactBar, type Activity } from "./CompactBar";
import { ExpandedView } from "./ExpandedView";
import { PeekCard } from "./PeekCard";
import { currentPack, editStore, homePanelWidth, setEditing, widgetStore } from "../widgets/layout";
import { LiveProbes, useTopLive } from "../widgets/live";

export function IslandApp() {
  const island = useStore(islandStore);
  const media = useStore(mediaStore);
  const timer = useStore(timerStore);
  const chat = useStore(chatStore);
  const settings = useStore(settingsStore);
  const agents = useStore(agentsStore);
  const request = agents.pending[0] ?? null;
  const widgets = useStore(widgetStore);
  const edit = useStore(editStore);
  const live = useTopLive();
  const lyrics = useStore(lyricsStore);

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
  // Dua jalur: event drag-drop bawaan Tauri, dan penangkap file native dari Rust
  // (`native-file-drag`) yang dipakai di Windows karena jendela notch tembus klik.
  useEffect(() => {
    let lastDrop = 0;
    const onEnter = () => {
      setFileOver(true);
      expand("shelf");
    };
    const onLeave = () => setFileOver(false);
    const onDrop = (paths: string[]) => {
      setFileOver(false);
      pin(true);
      const now = Date.now();
      if (!paths.length || now - lastDrop < 800) return;
      lastDrop = now;
      void addToShelf(paths);
      play("drop");
      flashMood("happy");
    };
    const un = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter") onEnter();
      else if (p.type === "drop") onDrop(p.paths);
      else if (p.type === "leave") onLeave();
    });
    const unNative = listen<{ kind: "enter" | "leave" | "drop"; paths: string[] }>("native-file-drag", (e) => {
      if (e.payload.kind === "enter") onEnter();
      else if (e.payload.kind === "drop") onDrop(e.payload.paths);
      else onLeave();
    });
    return () => {
      void un.then((f) => f());
      void unNative.then((f) => f());
    };
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

  // ---- Sesi Claude Code di terminal selesai ----
  useEffect(
    () =>
      onAgentFinished((f) => {
        play(f.ok ? "done" : "error");
        flashMood(f.ok ? "happy" : "error", 3000);
        setLastActive(Date.now());
        const s = islandStore.get();
        if (s.mode === "expanded" && s.tab === "agents") return;
        showPeek({
          kind: "claude",
          title: f.ok ? `Claude beres di ${f.project}` : `Claude ketemu masalah di ${f.project}`,
          body: f.message.replace(/\s+/g, " ").slice(0, 90) || undefined,
          mood: f.ok ? "happy" : "error",
          openTab: "agents",
          timeoutMs: 10000,
        });
      }),
    [],
  );

  // ---- Chat Claude nanya sesuatu: jawabnya tetap di chat ----
  useEffect(
    () =>
      onAgentAttention((f) => {
        play("chime");
        setLastActive(Date.now());
        showPeek({
          kind: "claude",
          title: "Claude nanya sesuatu",
          body: f.message.replace(/\s+/g, " ").slice(0, 90) || "Balik ke chat buat jawab.",
          mood: "notify",
          openTab: "agents",
          timeoutMs: 20000,
        });
      }),
    [],
  );

  // ---- Claude minta izin / nanya: bunyi sekali tiap permintaan baru ----
  const lastRequest = useRef<string | null>(null);
  useEffect(() => {
    if (request && request.id !== lastRequest.current) {
      play("chime");
      setLastActive(Date.now());
    }
    lastRequest.current = request?.id ?? null;
  }, [request]);

  // Durasi di pengaturan berubah -> sesuaikan timer yang lagi diam.
  useEffect(() => {
    syncTimerWithSettings();
  }, [settings?.focusMinutes, settings?.shortBreakMinutes, settings?.longBreakMinutes]);

  // ---- Ukuran pulau ----
  const agent = activeSession(agents);
  // Live widget yang penting (prioritas ≥ 3) nyalip timer & musik; yang santai cuma kalau sepi.
  const activity: Activity = chat.running
    ? "claude"
    : agent
      ? "agent"
      : live && live.priority >= 3
        ? "live"
        : timer.running
          ? "timer"
          : media?.isPlaying
            ? "music"
            : live
              ? "live"
              : null;

  // Lagu yang lagi diputer punya lirik sinkron: lirik jalan di tengah notch kecil.
  const lyricBar =
    activity === "music" &&
    settings?.showLyrics !== false &&
    settings?.compactLyrics !== false &&
    lyrics.status === "ready" &&
    lyrics.lines.length > 0 &&
    lyrics.key === trackKey(media);

  // Beranda melebar ngikutin jumlah kolom widget.
  const homeCols = useMemo(() => currentPack(widgets, edit.editing).cols, [widgets, edit.editing]);
  const homeW = homePanelWidth(homeCols);

  // Keluar dari mode Atur pas notch ditutup atau pindah tab.
  useEffect(() => {
    if (edit.editing && (island.mode !== "expanded" || island.tab !== "home")) setEditing(false);
  }, [island.mode, island.tab, edit.editing]);

  const size = useMemo(() => {
    if (request) return approvalSize(request);
    if (island.mode === "expanded") {
      return island.tab === "home" ? { ...SIZES.expanded.home, w: homeW } : SIZES.expanded[island.tab];
    }
    if (island.mode === "peek") return SIZES.peek;
    if (lyricBar) return SIZES.compactLyrics;
    return activity ? SIZES.compactWide : SIZES.compactBase;
  }, [island.mode, island.tab, activity, request, homeW, lyricBar]);

  // Kebuka penuh selalu di tengah; selain itu di tempat terakhir notch digeser.
  const offset = island.mode === "expanded" && !request ? 0 : clampOffset(island.offset, size.w);
  const drag = useIslandDrag(size.w);

  useEffect(() => {
    reportHit(size.w, size.h, offset);
  }, [size.w, size.h, offset]);

  // ---- Suasana hati Pip ----
  const idleLong = !island.hover && !activity && now - lastActive > 3 * 60_000;
  const agentTool = !!agent?.steps.some((s) => (s.kind === "tool" || s.kind === "task") && s.ok === null);
  const mood: PipMood = request
    ? "notify"
    : island.fileOver
      ? "listening"
      : flash
        ? flash
        : island.mode === "peek" && island.peek
          ? island.peek.mood
          : chat.running
            ? chat.lastActivity === "working"
              ? "working"
              : "thinking"
            : agent
              ? agentTool
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

  // ---- Pip di desktop: kirim mood, dan panggil dia ke notch pas ada notif ----
  const petMode = settings?.petMode ?? false;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  useEffect(() => {
    if (petMode) void emitTo("pet", "pip-mood", { mood });
  }, [mood, petMode]);
  // Jendela Pip desktop baru kebuka: kasih tahu mood sekarang.
  useEffect(() => {
    const un = listen("pet-ready", () => void emitTo("pet", "pip-mood", { mood: moodRef.current }));
    return () => void un.then((f) => f());
  }, []);

  const alertActive = petMode && (!!request || (island.mode === "peek" && !!island.peek));
  const alertOffset = Math.round(offset + size.w / 2 + 44);
  useEffect(() => {
    if (!petMode) return;
    void emitTo("pet", "pet-alert", { active: alertActive, offset: alertOffset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertActive, petMode]);

  if (!settings) return null;

  return (
    <div className={`stage${island.dragging ? " dragging" : ""}`}>
      <LiveProbes />
      <div className="island-shell" style={{ width: size.w, height: size.h, transform: `translateX(${offset}px)` }}>
        <span className="shoulder left" />
        <span className="shoulder right" />
        <div
          className={`island mode-${request ? "approval" : island.mode}${island.fileOver ? " file-over" : ""}`}
          onMouseDown={() => {
            if (islandStore.get().mode === "expanded") pin(true);
          }}
          {...drag}
          onClick={() => {
            if (Date.now() < petDrag.suppressClickUntil) return;
            if (islandStore.get().mode === "compact") expand();
          }}
        >
          {request ? (
            <ApprovalCard key={request.id} request={request} more={agents.pending.length - 1} />
          ) : (
            <>
              {island.mode === "compact" && <CompactBar mood={mood} activity={activity} live={live} lyrics={lyricBar} />}
              {island.mode === "peek" && island.peek && <PeekCard peek={island.peek} mood={mood} />}
              {island.mode === "expanded" && <ExpandedView mood={mood} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
