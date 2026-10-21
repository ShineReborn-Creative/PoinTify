import { emitTo, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Pip, type PipMood } from "../components/Pip";
import { api, type PetMove } from "../lib/api";
import { useStore } from "../lib/store";
import type { PipEngine } from "../pip/engine";
import { IS_WINDOWS } from "../state/pet";
import { settingsStore } from "../state/settings";
import { pipConditionStore } from "../widgets/data";
import { chatter, EMPTY_CONTEXT, eventLine, fileComment, type PetCond, type PetContext, type PetLive, EVENT_LINES } from "./talk";

const PIP_SIZE = 84;
/** Jeda antar gerak sendiri (detik) per tingkat aktif. */
const ACTIVITY: Record<string, [number, number]> = { calm: [35, 90], normal: [9, 26], hyper: [3, 10] };
const EVENT_COOLDOWN = 12_000;

type Motion = { kind: string; dir: number; power: number };
type Bubble = { id: number; text: string };

function quietOn() {
  try {
    return localStorage.getItem("pointify.quiet.v1") === "1";
  } catch {
    return false;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Jendela Pip di desktop. Mood-nya ngikutin notch, fisikanya dijalanin Rust. */
export function PetApp() {
  const settings = useStore(settingsStore);
  const [mood, setMood] = useState<PipMood>("wave");
  const [flash, setFlash] = useState<PipMood | null>(null);
  const [carried, setCarried] = useState(false);
  const [hover, setHover] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [ctx, setCtx] = useState<PetContext>(EMPTY_CONTEXT);
  const [live, setLive] = useState<PetLive>({ info: null, offset: 0 });
  const [sleeping, setSleeping] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [face, setFace] = useState<1 | -1>(1);
  /** Lu lagi ngetik di keyboard (ditebak Rust tanpa baca isi ketikan). */
  const [typing, setTyping] = useState(false);
  /** Lagi main kejar-kejaran. */
  const [chasing, setChasing] = useState(false);
  /** Ada file yang lagi diseret ke atas Pip. */
  const [smelling, setSmelling] = useState(false);
  /** Lu lagi nyeret file/folder dari Explorer atau desktop (di mana aja). */
  const [fileNear, setFileNear] = useState(false);

  const engine = useRef<PipEngine | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const signRef = useRef<HTMLButtonElement>(null);
  const gait = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const lastTouch = useRef(Date.now());
  const nextMove = useRef(Date.now() + 6000);
  const nextTalk = useRef(Date.now() + 25_000);
  const lastEventLine = useRef(0);
  const dizzyOnLand = useRef(false);
  const perched = useRef(false);
  const approaching = useRef(false);
  const chasingRef = useRef(false);
  const visiting = useRef(false);
  const rub = useRef<{ x: number; dir: number; flips: number[] }>({ x: 0, dir: 0, flips: [] });

  // Nilai terbaru buat dipakai di timer.
  const s = useRef({ settings, mood, carried, hover, sleeping, playing, ctx, live, typing });
  s.current = { settings, mood, carried, hover, sleeping, playing, ctx, live, typing };

  const talkOn = () => (s.current.settings?.petTalkMinutes ?? 3) > 0 && !quietOn();

  const say = useCallback((text: string | null, ms = 4200) => {
    if (!text) return;
    window.clearTimeout(bubbleTimer.current);
    setBubble({ id: Date.now(), text });
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  /** Kalimat buat kejadian (jatuh, dielus, ...), dibatesin biar nggak cerewet. */
  const sayEvent = useCallback(
    (kind: keyof typeof EVENT_LINES, chance = 1) => {
      if (!talkOn() || Math.random() > chance) return;
      if (Date.now() - lastEventLine.current < EVENT_COOLDOWN) return;
      lastEventLine.current = Date.now();
      say(eventLine(kind));
    },
    [say],
  );

  const flashMood = useCallback((m: PipMood, ms = 2200) => {
    setFlash(m);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  }, []);

  /** Ada perhatian dari lu: reset hitungan tidur siang, bangunin kalau lagi tidur. */
  const touch = useCallback(() => {
    lastTouch.current = Date.now();
    if (s.current.sleeping) {
      setSleeping(false);
      engine.current?.wave();
      sayEvent("wake");
    }
  }, [sayEvent]);

  const stopGait = () => {
    window.clearInterval(gait.current);
    gait.current = undefined;
  };
  const startGait = (ms: number, power: number) => {
    stopGait();
    gait.current = window.setInterval(() => engine.current?.jump(power), ms);
  };

  // Sapaan pas keluar dari notch.
  useEffect(() => {
    const t = window.setTimeout(() => setMood((m) => (m === "wave" ? "idle" : m)), 2200);
    const hello = window.setTimeout(() => sayEvent("hello", 0.7), 900);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(hello);
    };
  }, [sayEvent]);

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

  // Area badan Pip (dan papan) dikirim ke Rust, biar sisa jendela tembus klik.
  const signShown = !!(settings?.petLiveSign !== false && live.info);
  useLayoutEffect(() => {
    const report = () => {
      const b = bodyRef.current?.getBoundingClientRect();
      if (!b) return;
      const extra = [];
      const sg = signRef.current?.getBoundingClientRect();
      if (sg && sg.width > 0) extra.push({ x: sg.left, y: sg.top, w: sg.width, h: sg.height });
      void api.petSetHit({ x: b.left, y: b.top, w: b.width, h: b.height }, extra);
    };
    report();
    const t = window.setTimeout(report, 300);
    window.addEventListener("resize", report);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", report);
    };
  }, [signShown, face, live.info?.label, live.info?.value]);

  // Kabar dari Rust dan dari notch.
  useEffect(() => {
    const subs = [
      listen<{ mood: PipMood }>("pip-mood", (e) => setMood(e.payload.mood)),
      listen<PetContext>("pet-context", (e) => setCtx(e.payload)),
      listen<PetLive>("pet-live", (e) => setLive(e.payload)),
      listen<PetCond>("pet-cond", (e) => pipConditionStore.set(e.payload)),
      listen<boolean>("pet-typing", (e) => setTyping(e.payload)),
      listen<boolean>("pet-file-near", (e) => setFileNear(e.payload)),
      listen<{ kind: string; paths: string[] }>("pet-file-drag", (e) => {
        const { kind, paths } = e.payload;
        if (kind === "enter") {
          touch();
          setSmelling(true);
          engine.current?.surprise();
          sayEvent("smell", 0.8);
        } else if (kind === "leave") {
          setSmelling(false);
        } else if (kind === "drop") {
          setSmelling(false);
          setFileNear(false);
          if (!paths.length) return;
          // Dicatet ke Rak diem-diem (notch nggak kebuka), filenya tetap di tempat asal.
          void emitTo("main", "pet-ate", { paths });
          // Nyam nyam nyam.
          engine.current?.chomp(3);
          window.setTimeout(() => flashMood("happy", 2000), 650);
          if (talkOn()) {
            lastEventLine.current = Date.now();
            window.setTimeout(() => say(fileComment(paths)), 450);
          }
        }
      }),
      listen<boolean>("pet-carry", (e) => {
        setCarried(e.payload);
        if (e.payload) {
          stopGait();
          engine.current?.setLean(0);
          touch();
        }
      }),
      listen<boolean>("pet-hover", (e) => {
        setHover(e.payload);
        engine.current?.hover(e.payload);
        if (e.payload) touch();
      }),
      listen<{ x: number; y: number }>("pet-cursor", (e) => {
        // Kursor deket Pip = lagi diperhatiin.
        const b = bodyRef.current?.getBoundingClientRect();
        if (!b) return;
        const d = Math.hypot(e.payload.x - (b.left + b.width / 2), e.payload.y - (b.top + b.height / 2));
        if (d < 95) touch();
      }),
      listen<{ moving: boolean; dir: number }>("pet-moving", (e) => {
        // Terbang ke/dari notch.
        if (e.payload.moving) {
          engine.current?.lookAt(e.payload.dir, 0.15);
          startGait(300, 0.6);
        } else {
          stopGait();
          engine.current?.land(0.6);
        }
      }),
      listen<Motion>("pet-motion", (e) => {
        const { kind, dir, power } = e.payload;
        const eng = engine.current;
        if (dir === 1 || dir === -1) setFace(dir);
        switch (kind) {
          case "walk":
            eng?.lookAt(dir, 0.1);
            eng?.setLean(dir * 3);
            startGait(330, 0.32);
            break;
          case "run":
            eng?.lookAt(dir, 0);
            eng?.setLean(dir * 8);
            startGait(190, 0.5);
            break;
          case "jump":
            stopGait();
            eng?.setLean(dir * 6);
            eng?.jump(1 + power);
            break;
          case "climb":
            eng?.lookAt(dir, -1);
            eng?.setLean(dir * 22);
            startGait(240, 0.22);
            sayEvent("climb", 0.4);
            break;
          case "cling":
            stopGait();
            eng?.setLean(dir * 14);
            eng?.lookAt(-dir * 0.8, 0.3);
            break;
          case "thrown":
            stopGait();
            eng?.surprise();
            dizzyOnLand.current = power > 2.6;
            sayEvent("thrown", 0.6);
            break;
          case "fall":
            stopGait();
            eng?.setLean(0);
            eng?.surprise();
            sayEvent("fall", 0.8);
            break;
          case "bonk":
            eng?.bonk(dir, power);
            if (power > 1.2) sayEvent("bonk", 0.5);
            break;
          case "bounce":
            eng?.land(power * 0.7);
            break;
          case "land":
          case "perch":
            stopGait();
            eng?.setLean(0);
            eng?.land(Math.min(power, 2.4));
            perched.current = kind === "perch";
            if (dizzyOnLand.current) {
              dizzyOnLand.current = false;
              eng?.dizzy();
              sayEvent("dizzy");
            } else if (kind === "perch") {
              sayEvent("perch", 0.4);
            }
            break;
          case "idle":
            stopGait();
            eng?.setLean(0);
            if (approaching.current) {
              approaching.current = false;
              eng?.lookAt(0, -1);
              sayEvent("lookup", 0.5);
            }
            break;
          case "approach":
            approaching.current = true;
            eng?.lookAt(dir, -0.4);
            eng?.setLean(dir * 3);
            startGait(360, 0.3);
            break;
          case "crouch":
            stopGait();
            eng?.crouch(dir);
            break;
          case "pounce":
            stopGait();
            eng?.setLean(dir * 12);
            eng?.jump(1.6);
            break;
          case "pounce-hit":
            eng?.cheer();
            flashMood("happy", 1600);
            sayEvent("pounceHit", 0.6);
            break;
          case "pounce-miss":
            eng?.sulk();
            sayEvent("pounceMiss", 0.5);
            break;
          case "dodge":
            stopGait();
            eng?.surprise();
            eng?.setLean(dir * 10);
            sayEvent("dodge", 0.5);
            break;
          case "touch":
            eng?.cheer();
            sayEvent("touch", 0.25);
            break;
          case "chase-end":
            setChasing(false);
            stopGait();
            eng?.setLean(0);
            flashMood("happy", 2000);
            lastEventLine.current = 0;
            sayEvent("chaseEnd");
            break;
        }
      }),
      listen<{ active: boolean; offset: number }>("pet-alert", (e) => {
        if (e.payload.active) void api.petVisit(e.payload.offset);
        else void api.petReturn();
      }),
    ];
    // Minta keadaan terbaru dari notch, abis sapaan.
    const ready = window.setTimeout(() => void emitTo("main", "pet-ready", null), 2300);
    return () => {
      window.clearTimeout(ready);
      stopGait();
      subs.forEach((p) => void p.then((f) => f()));
    };
  }, [sayEvent, touch]);

  // Barang yang dipakai: ikat kepala pas fokus, laptop pas Claude kerja atau lu lagi ngetik.
  const follow = settings?.petFollow !== false;
  const busyTyping = follow && typing && !carried && !sleeping;
  useEffect(() => {
    // Lagi nonton: laptopnya disimpen dulu, gantian megang popcorn.
    const laptop = (ctx.claude || busyTyping) && mood !== "watching";
    engine.current?.setProp(follow ? (ctx.focus ? "headband" : laptop ? "laptop" : null) : null);
  }, [follow, ctx.focus, ctx.claude, busyTyping, mood]);

  // Mulai nonton: Pip duduk anteng, pasang kacamata, ambil popcorn.
  useEffect(() => {
    if (mood !== "watching") return;
    stopGait();
    engine.current?.setLean(0);
    sayEvent("watch", 0.8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mood, sayEvent]);
  // Mulai ngetik: Pip berhenti jalan dan ikut ngetik.
  useEffect(() => {
    if (!busyTyping) return;
    stopGait();
    engine.current?.setLean(0);
    nextMove.current = Math.max(nextMove.current, Date.now() + 8000);
  }, [busyTyping]);

  // Boleh main sama kursor cuma pas santai.
  const calmNow = (mood === "idle" || mood === "music") && !busyTyping && !sleeping && !carried && !playing && !ctx.focus && !ctx.claude;
  const playOk = settings?.petCursor !== false && calmNow;
  useEffect(() => {
    void api.petPlay(playOk);
  }, [playOk]);

  // Otak kecil: gerak sendiri, ngomong, tidur siang. Dicek tiap detik.
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = s.current;
      const cfg = c.settings;
      const now = Date.now();
      const calmMood = (c.mood === "idle" || c.mood === "music") && !(c.typing && c.settings?.petFollow !== false);
      const free = !c.carried && !c.hover && !c.sleeping && !c.playing && !visiting.current && !chasingRef.current;

      // Tidur siang kalau lama dicuekin (malem lebih cepet ngantuk).
      const h = new Date().getHours();
      const napAfter = (h >= 22 || h < 5 ? 3 : 7) * 60_000;
      if (cfg?.petNap !== false && free && calmMood && !c.ctx.music && !c.ctx.claude && now - lastTouch.current > napAfter) {
        setSleeping(true);
        stopGait();
        return;
      }

      // Gerak sendiri.
      if (cfg?.petWander !== false && free && calmMood && !c.ctx.claude && now >= nextMove.current) {
        const [lo, hi] = ACTIVITY[cfg?.petActivity ?? "normal"] ?? ACTIVITY.normal;
        // Lagi fokus: kalem banget biar nggak ganggu.
        const slow = c.ctx.focus ? 4 : 1;
        nextMove.current = now + rand(lo, hi) * 1000 * slow;
        const r = Math.random();
        let kind: PetMove;
        if (c.ctx.focus) kind = "walk";
        else if (perched.current) kind = r < 0.35 ? "jumpdown" : r < 0.75 ? "walk" : "hop";
        else if (c.mood === "music") kind = r < 0.6 ? "hop" : "walk";
        else kind = r < 0.38 ? "walk" : r < 0.58 ? "run" : r < 0.8 ? "hop" : r < 0.9 ? "climb" : "jump";
        void api.petDo(kind);
      }

      // Ngobrol rutin.
      const minutes = cfg?.petTalkMinutes ?? 3;
      if (minutes > 0 && now >= nextTalk.current) {
        nextTalk.current = now + minutes * 60_000 * rand(0.85, 1.15);
        if (!c.sleeping && !c.carried && !quietOn()) say(chatter(c.ctx, pipConditionStore.get(), c.live.info));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [say]);

  // Papan Live: info urgent bikin Pip lari ke notch sambil ngacungin papan.
  const liveKey = live.info && live.info.priority >= 5 ? `${live.info.id}:${live.info.label}` : "";
  useEffect(() => {
    if (!liveKey || settings?.petLiveSign === false || visiting.current) return;
    visiting.current = true;
    void api.petVisit(live.offset);
    const t = window.setTimeout(() => {
      visiting.current = false;
      void api.petReturn();
    }, 9000);
    return () => {
      window.clearTimeout(t);
      if (visiting.current) {
        visiting.current = false;
        void api.petReturn();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  // ---- Interaksi ----

  // Dipegang: ikut kursor sampai dilepas (dan bisa dilempar). Nggak gerak = klik biasa.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    touch();
    nextMove.current = Date.now() + 15_000;
    void api.petCarry(e.clientX, e.clientY).then((r) => {
      if (!r.moved) engine.current?.tap();
    });
  };

  // Dielus: kursor digosok bolak-balik di atas Pip.
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons) return;
    const r = rub.current;
    const dx = e.clientX - r.x;
    if (Math.abs(dx) < 4) return;
    r.x = e.clientX;
    const dir = Math.sign(dx);
    const now = Date.now();
    if (dir !== r.dir) {
      r.dir = dir;
      r.flips = [...r.flips.filter((t) => now - t < 1300), now];
      if (r.flips.length >= 4) {
        r.flips = [];
        touch();
        engine.current?.pet();
        flashMood("happy", 1800);
        sayEvent("pet", 0.7);
      }
    }
  };

  const drinkWater = () => {
    touch();
    void emitTo("main", "pet-drink", null);
    flashMood("happy");
    engine.current?.jump(0.8);
    say(eventLine("drink"));
  };

  const chase = () => {
    touch();
    setChasing(true);
    chasingRef.current = true;
    lastEventLine.current = 0;
    sayEvent("chaseStart");
    flashMood("happy", 20_000);
    void api.petChase(20);
    window.setTimeout(() => {
      chasingRef.current = false;
    }, 20_500);
  };

  const play = () => {
    touch();
    setPlaying(true);
    flashMood("happy", 9000);
    say(eventLine("play"), 2500);
    void api.petDo("run");
    const t1 = window.setTimeout(() => void api.petDo("run"), 2800);
    const t2 = window.setTimeout(() => void api.petDo("hop"), 5600);
    window.setTimeout(() => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setPlaying(false);
    }, 9000);
  };

  const openMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    touch();
    try {
      const { Menu } = await import("@tauri-apps/api/menu");
      const menu = await Menu.new({
        items: [
          { id: "drink", text: "Kasih minum 💧", action: drinkWater },
          { id: "play", text: "Ajak main bola ⚽", action: play },
          chasing
            ? { id: "chase", text: "Udahan kejar-kejaran", action: () => void api.petChase(0) }
            : { id: "chase", text: "Main kejar-kejaran 🏃", action: chase },
          {
            id: "nap",
            text: s.current.sleeping ? "Bangun ☀️" : "Tidur 💤",
            action: () => {
              if (s.current.sleeping) touch();
              else {
                setSleeping(true);
                sayEvent("sleep");
              }
            },
          },
          { item: "Separator" },
          { id: "open", text: "Buka notch", action: () => void emitTo("main", "pet-open", null) },
          { id: "home", text: "Pulang ke notch", action: () => void api.petHome() },
        ],
      });
      await menu.popup();
    } catch {
      // Menu nggak kebuka (misalnya di preview): nggak apa-apa.
    }
  };

  // Mangap lebar selama ada file yang lagi diseret.
  const hungry = (fileNear || smelling) && !carried;
  useEffect(() => {
    engine.current?.setHungry(hungry);
    if (hungry) touch();
  }, [hungry, touch]);

  const shown: PipMood = carried || hungry
    ? "listening"
    : sleeping
      ? "sleep"
      : flash ?? (busyTyping && (mood === "idle" || mood === "music") ? "working" : mood);
  const sign = signShown ? live.info : null;

  return (
    <div className="pet-stage" onPointerUp={IS_WINDOWS ? undefined : () => void api.petDrop()}>
      {bubble && (
        <div key={bubble.id} className="pet-bubble" role="status">
          {bubble.text}
        </div>
      )}
      {sign && (
        <button
          ref={signRef}
          className={`pet-sign side-${face > 0 ? "r" : "l"}${sign.tone ? ` ${sign.tone}` : ""}${sign.priority >= 5 ? " urgent" : ""}`}
          title="Buka widget-nya"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            touch();
            void emitTo("main", "pet-open-live", { id: sign.id });
          }}
        >
          <Icon name={sign.icon as IconName} size={12} />
          <span className="pet-sign-label">{sign.label}</span>
          <b>{sign.value}</b>
        </button>
      )}
      {playing && <span className={`pet-ball side-${face > 0 ? "r" : "l"}`} aria-hidden="true" />}
      <div
        className={`pet-body${carried ? " carried" : ""}`}
        ref={bodyRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={() => {
          touch();
          void emitTo("main", "pet-open", null);
        }}
        onContextMenu={(e) => void openMenu(e)}
      >
        <Pip mood={shown} size={PIP_SIZE} glow onEngine={(e) => (engine.current = e)} />
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
