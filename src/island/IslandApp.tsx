import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PipMood } from "../components/Pip";
import { api } from "../lib/api";
import { play } from "../lib/sound";
import { useStore } from "../lib/store";
import { activeSession, agentsStore, onAgentAttention, onAgentFinished } from "../state/agents";
import { chatStore, onClaudeFinished } from "../state/chat";
import {
  beforeCollapse,
  blurGuard,
  clampOffset,
  collapse,
  dismissPeek,
  expand,
  islandStore,
  OFFSET_KEY,
  paletteHeightStore,
  pin,
  reportHit,
  saveOffset,
  setFileOver,
  setHover,
  setOffset,
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
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { downloadsStore, onDownloadDone } from "../state/downloads";
import { TourCard } from "./TourCard";
import { startTour } from "./tour";
import { checkUpdate, installUpdate } from "../state/update";
import { usePetBridge } from "./usePetBridge";
import { currentPack, editStore, homePanelWidth, setEditing, widgetStore } from "../widgets/layout";
import { LiveProbes, useTopLive } from "../widgets/live";
import { tr } from "../i18n";
import { foregroundStore } from "../state/foreground";
import { isHiddenApp, pillSlides } from "../lib/pill";

export function IslandApp() {
  const island = useStore(islandStore);
  const media = useStore(mediaStore);
  const chat = useStore(chatStore);
  const settings = useStore(settingsStore);
  const agents = useStore(agentsStore);
  const downloads = useStore(downloadsStore);
  const paletteH = useStore(paletteHeightStore);
  const request = agents.pending[0] ?? null;
  const widgets = useStore(widgetStore);
  const edit = useStore(editStore);
  const live = useTopLive();
  const fg = useStore(foregroundStore);
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
    // Pertama kali buka: Pip ngajak tour.
    const tourTimer = settingsStore.get()?.tourDone ? undefined : window.setTimeout(() => startTour(), 1600);
    return () => window.clearTimeout(tourTimer);
  }, []);

  // Tour diulang dari Pengaturan.
  useEffect(() => {
    const un = listen("tour-start", () => startTour());
    return () => void un.then((f) => f());
  }, []);

  // Cek versi baru diem-diem sebentar setelah nyala.
  useEffect(() => {
    if (settingsStore.get()?.autoUpdate === false) return;
    const id = window.setTimeout(async () => {
      const u = await checkUpdate();
      if (u.status !== "available") return;
      showPeek({
        kind: "info",
        title: tr(`PoinTify ${u.version} udah ada`, `PoinTify ${u.version} is out`),
        body: tr("Pasang sekarang? PoinTify bakal restart sebentar.", "Install now? PoinTify will restart briefly."),
        mood: "notify",
        actions: [
          { label: tr("Nanti", "Later"), run: () => dismissPeek() },
          { label: tr("Pasang", "Install"), primary: true, run: () => { dismissPeek(); void installUpdate(); } },
        ],
      });
    }, 20_000);
    return () => window.clearTimeout(id);
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

  // Posisi notch diubah dari jendela lain (Pengaturan › Lanjutan › Tengahin).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== OFFSET_KEY) return;
      const v = Number(e.newValue);
      setOffset(Number.isFinite(v) ? v : 0);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ---- Event lain dari Rust: tray, shortcut, app fullscreen ----
  useEffect(() => {
    const subs = [
      listen<string>("island-open", () => expand("home")),
      listen("palette-open", () => {
        const s = islandStore.get();
        if (s.mode === "expanded" && s.tab === "palette") return collapse();
        expand("palette");
        pin(true);
        void api.focusIsland();
      }),
      listen("island-reset-offset", () => {
        setOffset(0);
        saveOffset();
      }),
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
            title: tr("Waktunya minum", "Time to drink"),
            body: tr(`Udah ${w.count} dari ${goal} gelas hari ini.`, `${w.count} of ${goal} glasses today.`),
            mood: "notify",
            actions: [
              { label: tr("Nanti", "Later"), run: () => { snoozeWater(10); dismissPeek(); } },
              { label: tr("Udah minum", "Done"), primary: true, run: () => { drink(); dismissPeek(); flashMood("happy"); } },
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
          title: finished === "focus" ? tr("Sesi fokus beres!", "Focus session done!") : tr("Istirahat selesai", "Break's over"),
          body:
            finished === "focus"
              ? auto
                ? tr(`${PHASE_LABEL[next]} dimulai. Regangin badan dulu.`, `${PHASE_LABEL[next]} started. Stretch a little.`)
                : tr(`Lanjut ${PHASE_LABEL[next].toLowerCase()}?`, `Start ${PHASE_LABEL[next].toLowerCase()}?`)
              : tr("Siap fokus lagi?", "Ready to focus again?"),
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
          title: ok ? tr("Claude udah jawab", "Claude replied") : tr("Claude ketemu masalah", "Claude hit a problem"),
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
          title: f.ok ? tr(`Claude beres di ${f.project}`, `Claude finished in ${f.project}`) : tr(`Claude ketemu masalah di ${f.project}`, `Claude hit a problem in ${f.project}`),
          body: f.message.replace(/\s+/g, " ").slice(0, 90) || undefined,
          mood: f.ok ? "happy" : "error",
          openTab: "agents",
          timeoutMs: 10000,
        });
      }),
    [],
  );

  // ---- Download beres: Pip seneng, tawarin buka foldernya atau taruh di Rak ----
  useEffect(
    () =>
      onDownloadDone((d) => {
        play("done");
        flashMood("happy", 3000);
        setLastActive(Date.now());
        showPeek({
          kind: "info",
          title: tr("Download beres", "Download finished"),
          body: d.name,
          mood: "happy",
          timeoutMs: 12000,
          actions: [
            {
              label: tr("Folder", "Folder"),
              run: () => {
                void revealItemInDir(d.path);
                dismissPeek();
              },
            },
            {
              label: tr("Ke Rak", "To Shelf"),
              primary: true,
              run: () => {
                void addToShelf([d.path]);
                dismissPeek();
              },
            },
          ],
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
          title: tr("Claude nanya sesuatu", "Claude has a question"),
          body: f.message.replace(/\s+/g, " ").slice(0, 90) || tr("Balik ke chat buat jawab.", "Go back to the chat to answer."),
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
  // Lagu paling utama: selama diputer, pil nggak ganti tampilan. Selain itu,
  // yang penting (Claude, sesi, Live prioritas ≥ 3) nyelak; pas sepi, info gantian.
  // Timer fokus cukup lingkaran kecil di pojok kanan (lihat CompactBar).
  // Kalau semua info pil dimatiin (atau app-nya disembunyiin), pil balik polos.
  const pillOn = pillSlides(settings);
  const ambientAny = pillOn.some((k) => (k === "app" ? !!fg && !isHiddenApp(settings, fg.exe) : k === "live" ? !!live : true));
  const activity: Activity = media?.isPlaying
    ? "music"
    : chat.running
      ? "claude"
      : agent
        ? "agent"
        : downloads.length
          ? "download"
          : live && live.priority >= 3
            ? "live"
            : ambientAny
              ? "ambient"
              : null;

  // Lagu yang lagi diputer punya lirik sinkron: lirik jalan di tengah notch kecil.
  // Timer fokus yang jalan bareng lagu tetap di kanan, liriknya tetap di tengah.
  const lyricBar =
    activity === "music" &&
    !!media?.isPlaying &&
    media.kind !== "video" &&
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
      if (island.tab === "palette") return { w: SIZES.expanded.palette.w, h: paletteH };
      return island.tab === "home" ? { ...SIZES.expanded.home, w: homeW } : SIZES.expanded[island.tab];
    }
    if (island.mode === "peek") return island.peek?.kind === "tour" ? SIZES.tour : SIZES.peek;
    if (lyricBar) return SIZES.compactLyrics;
    return activity === "ambient" ? SIZES.compactAmbient : activity ? SIZES.compactWide : SIZES.compactBase;
  }, [island.mode, island.tab, island.peek?.kind, activity, request, homeW, lyricBar, paletteH]);

  // Lagi melar atau nyusut? Melar pakai pegas yang mantul, nyusut yang kalem.
  const lastSize = useRef(size);
  const growing = useRef(true);
  if (size.w !== lastSize.current.w || size.h !== lastSize.current.h) {
    growing.current = size.w * size.h > lastSize.current.w * lastSize.current.h;
    lastSize.current = size;
  }

  // Pas nutup, isi notch (Beranda, chat, palette, apa pun yang lagi kebuka)
  // nggak langsung ilang: salinannya ditinggal sebentar, ikut kesedot ke pil
  // sambil memudar. Salinan doang (bukan komponen asli), jadi nggak ada efek
  // samping kayak timer atau fokus input yang jalan dua kali.
  const ghostHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const leave = () => {
      const host = ghostHost.current;
      const live = host?.parentElement?.querySelector<HTMLElement>(":scope > .expanded");
      if (!host || !live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const ghost = live.cloneNode(true) as HTMLElement;
      ghost.className = "expanded island-ghost";
      ghost.style.width = `${live.offsetWidth}px`;
      ghost.style.height = `${live.offsetHeight}px`;
      // cloneNode nggak bawa posisi scroll, jadi disalin manual biar nggak loncat.
      const from = live.querySelectorAll<HTMLElement>("*");
      const to = ghost.querySelectorAll<HTMLElement>("*");
      from.forEach((el, i) => {
        const { scrollTop, scrollLeft } = el;
        if (scrollTop || scrollLeft) {
          const t = to[i];
          requestAnimationFrame(() => {
            t.scrollTop = scrollTop;
            t.scrollLeft = scrollLeft;
          });
        }
      });
      host.replaceChildren(ghost);
      window.setTimeout(() => ghost.remove(), 420);
    };
    beforeCollapse.add(leave);
    return () => {
      beforeCollapse.delete(leave);
    };
  }, []);

  // Kebuka penuh selalu di tengah; selain itu di tempat terakhir notch digeser.
  const offset = island.mode === "expanded" && !request ? 0 : clampOffset(island.offset, size.w);
  const drag = useIslandDrag(size.w);

  useEffect(() => {
    reportHit(size.w, size.h, offset);
  }, [size.w, size.h, offset]);

  // ---- Suasana hati Pip ----
  const idleLong = !island.hover && (activity === "ambient" || activity === null) && now - lastActive > 3 * 60_000;
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
            ? media.kind === "video"
              ? "watching"
              : "music"
            : idleLong
              ? "sleep"
              : "idle";

  useEffect(() => {
    if (activity && activity !== "ambient") setLastActive(Date.now());
  }, [activity]);

  // ---- Pip di desktop: kirim mood, dan panggil dia ke notch pas ada notif ----
  const petMode = settings?.petMode ?? false;
  const alertActive = petMode && (!!request || (island.mode === "peek" && !!island.peek));
  const alertOffset = Math.round(offset + size.w / 2 + 44);
  usePetBridge({ petMode, mood, live, visitOffset: alertOffset });
  useEffect(() => {
    if (!petMode) return;
    void emitTo("pet", "pet-alert", { active: alertActive, offset: alertOffset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertActive, petMode]);

  if (!settings) return null;

  return (
    <div className={`stage${island.dragging ? " dragging" : ""}${growing.current ? " grow" : ""}`}>
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
          <div className="island-ghost-host" ref={ghostHost} aria-hidden="true" />
          {request ? (
            <ApprovalCard key={request.id} request={request} more={agents.pending.length - 1} />
          ) : (
            <>
              {island.mode === "compact" && <CompactBar mood={mood} activity={activity} live={live} lyrics={lyricBar} />}
              {island.mode === "peek" && island.peek && (island.peek.kind === "tour" ? <TourCard mood={mood} /> : <PeekCard peek={island.peek} mood={mood} />)}
              {island.mode === "expanded" && <ExpandedView mood={mood} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
