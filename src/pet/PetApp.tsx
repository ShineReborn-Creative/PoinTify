import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Pip, type PipMood } from "../components/Pip";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { PipEngine } from "../pip/engine";
import { IS_WINDOWS } from "../state/pet";
import { settingsStore } from "../state/settings";

const PIP_SIZE = 84;
/** Jeda antar jalan-jalan (detik). */
const WANDER_MIN = 25;
const WANDER_MAX = 70;

/** Jendela Pip di desktop. Mood-nya ngikutin notch, gerakannya dijalanin Rust. */
export function PetApp() {
  const settings = useStore(settingsStore);
  const [mood, setMood] = useState<PipMood>("wave");
  const [carried, setCarried] = useState(false);
  const [hover, setHover] = useState(false);
  const engine = useRef<PipEngine | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const nextWander = useRef(Date.now() + 15_000);
  const hopTimer = useRef<number | undefined>(undefined);

  // Sapaan pas keluar dari notch, abis itu ngikut mood notch.
  useEffect(() => {
    const t = window.setTimeout(() => setMood((m) => (m === "wave" ? "idle" : m)), 2200);
    return () => window.clearTimeout(t);
  }, []);

  // File yang nggak sengaja dijatuhin ke Pip jangan sampai dibuka sama WebView.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // Area badan Pip dikirim ke Rust, biar sisa jendela tembus klik.
  useEffect(() => {
    const report = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      void api.petSetHit({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    report();
    window.addEventListener("resize", report);
    return () => window.removeEventListener("resize", report);
  }, []);

  useEffect(() => {
    const subs = [
      listen<{ mood: PipMood }>("pip-mood", (e) => setMood(e.payload.mood)),
      listen<boolean>("pet-carry", (e) => {
        setCarried(e.payload);
        if (!e.payload) engine.current?.land();
      }),
      listen<boolean>("pet-hover", (e) => {
        setHover(e.payload);
        engine.current?.hover(e.payload);
      }),
      listen<{ moving: boolean; dir: number }>("pet-moving", (e) => {
        window.clearInterval(hopTimer.current);
        if (e.payload.moving) {
          const dir = e.payload.dir;
          engine.current?.lookAt(dir, 0.15);
          engine.current?.jump(0.8);
          hopTimer.current = window.setInterval(() => {
            engine.current?.lookAt(dir, 0.15);
            engine.current?.jump(0.6);
          }, 300);
        } else {
          engine.current?.land();
        }
      }),
      listen<{ active: boolean; offset: number }>("pet-alert", (e) => {
        if (e.payload.active) void api.petVisit(e.payload.offset);
        else void api.petReturn();
      }),
    ];
    // Minta mood terbaru dari notch, abis sapaan.
    const ready = window.setTimeout(() => void emitTo("main", "pet-ready", null), 2300);
    return () => {
      window.clearTimeout(ready);
      window.clearInterval(hopTimer.current);
      subs.forEach((p) => void p.then((f) => f()));
    };
  }, []);

  // Jalan-jalan sendiri kalau lagi santai.
  const wanderOn = settings?.petWander ?? true;
  useEffect(() => {
    if (!wanderOn) return;
    const id = window.setInterval(() => {
      if (busy.current || carried || hover || Date.now() < nextWander.current) return;
      if (mood !== "idle" && mood !== "music") return;
      busy.current = true;
      void api
        .petWander()
        .catch(() => 0)
        .finally(() => {
          busy.current = false;
          const s = WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN);
          nextWander.current = Date.now() + s * 1000;
        });
    }, 3000);
    return () => window.clearInterval(id);
  }, [wanderOn, carried, hover, mood]);

  // Dipegang: ikut kursor sampai dilepas. Nggak gerak = klik biasa.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    nextWander.current = Date.now() + WANDER_MIN * 1000;
    void api.petCarry(e.clientX, e.clientY).then((r) => {
      if (!r.moved) engine.current?.tap();
    });
  };

  return (
    <div className="pet-stage" onPointerUp={IS_WINDOWS ? undefined : () => void api.petDrop()}>
      <div className={`pet-body${carried ? " carried" : ""}`} ref={wrapRef} onPointerDown={onPointerDown}>
        <Pip
          mood={carried ? "listening" : mood}
          size={PIP_SIZE}
          glow
          onEngine={(e) => (engine.current = e)}
        />
        {hover && !carried && (
          <button
            className="pet-home"
            aria-label="Balik ke notch"
            title="Balik ke notch"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void api.petHome()}
          >
            <Icon name="home" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
