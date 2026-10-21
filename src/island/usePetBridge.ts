import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { PipMood } from "../components/Pip";
import { useNow } from "../lib/hooks";
import { useStore } from "../lib/store";
import type { PetContext, PetLive } from "../pet/talk";
import { activeSession, agentsStore } from "../state/agents";
import { chatStore } from "../state/chat";
import { expand } from "../state/island";
import { mediaStore } from "../state/media";
import { timerStore } from "../state/timer";
import { drink, waterDue, waterStore } from "../state/water";
import { pipConditionStore, type LiveInfo } from "../widgets/data";

type Args = {
  petMode: boolean;
  mood: PipMood;
  live: (LiveInfo & { id: string }) | null;
  /** Posisi buat Pip mampir (px logis dari tengah layar). */
  visitOffset: number;
};

/**
 * Jembatan notch ↔ Pip desktop: ngirim mood, kegiatan lu (musik, Claude,
 * fokus, waktunya minum), info Live, dan kondisi (panas/lemes/hujan) ke
 * jendela Pip, plus nerima permintaan dari Pip (buka notch, catat minum).
 */
export function usePetBridge({ petMode, mood, live, visitOffset }: Args) {
  const chat = useStore(chatStore);
  const agents = useStore(agentsStore);
  const timer = useStore(timerStore);
  const media = useStore(mediaStore);
  const water = useStore(waterStore);
  const cond = useStore(pipConditionStore);
  const now = useNow(30_000, petMode);

  const agent = activeSession(agents);
  const ctx: PetContext = {
    music: media?.isPlaying ? { title: media.title, artist: media.artist } : null,
    claude: chat.running || agent?.status === "working",
    focus: timer.running && timer.phase === "focus",
    waterDue: waterDue(now),
  };
  void water;
  const pl: PetLive = { info: live, offset: visitOffset };

  // "Tidur" di notch artinya notch lagi sepi; Pip desktop punya jam tidurnya sendiri.
  const petMood: PipMood = mood === "sleep" ? "idle" : mood;
  const latest = useRef({ mood: petMood, ctx, pl, cond });
  latest.current = { mood: petMood, ctx, pl, cond };

  const ctxKey = JSON.stringify(ctx);
  const liveKey = live ? `${live.id}|${live.label}|${live.value}|${live.priority}|${live.tone}` : "";
  const condKey = `${cond.hot}${cond.tired}${cond.rain}`;

  useEffect(() => {
    if (petMode) void emitTo("pet", "pip-mood", { mood: petMood });
  }, [petMood, petMode]);
  useEffect(() => {
    if (petMode) void emitTo("pet", "pet-context", latest.current.ctx);
  }, [ctxKey, petMode]);
  useEffect(() => {
    if (petMode) void emitTo("pet", "pet-live", latest.current.pl);
  }, [liveKey, petMode]);
  useEffect(() => {
    if (petMode) void emitTo("pet", "pet-cond", latest.current.cond);
  }, [condKey, petMode]);

  useEffect(() => {
    const subs = [
      // Jendela Pip baru kebuka: kasih tahu semua keadaan sekarang.
      listen("pet-ready", () => {
        const l = latest.current;
        void emitTo("pet", "pip-mood", { mood: l.mood });
        void emitTo("pet", "pet-context", l.ctx);
        void emitTo("pet", "pet-live", l.pl);
        void emitTo("pet", "pet-cond", l.cond);
      }),
      listen("pet-open", () => expand()),
      listen("pet-open-live", () => expand("home")),
      listen("pet-drink", () => drink()),
    ];
    return () => subs.forEach((p) => void p.then((f) => f()));
  }, []);
}
