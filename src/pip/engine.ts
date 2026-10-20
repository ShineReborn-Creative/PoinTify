/**
 * Mesin animasi Pip.
 *
 * Pip digambar pakai SVG dan digerakin tiap frame. Semua gerakan pakai
 * "pegas" (spring), jadi Pip bisa mantul, gepeng, miring, dan berhenti
 * dengan halus, bukan cuma ngulang animasi CSS yang sama terus.
 *
 * Nggak tergantung React: dipakai lewat komponen <Pip>, tapi juga bisa
 * jalan sendiri (misalnya buat demo).
 */

export type PipMood =
  | "idle"
  | "wave"
  | "thinking"
  | "working"
  | "notify"
  | "happy"
  | "sleep"
  | "listening"
  | "error"
  | "music";

export const MOOD_COLOR: Record<PipMood, string> = {
  idle: "#8B7CFF",
  wave: "#8B7CFF",
  thinking: "#4DA3FF",
  working: "#4DA3FF",
  notify: "#FFB340",
  happy: "#34C77B",
  sleep: "#5F5E66",
  listening: "#8B7CFF",
  error: "#FF5C5C",
  music: "#B98CFF",
};

type EyeMode = "open" | "happy" | "sleep" | "x" | "spiral" | "heart";
type MouthMode = "none" | "smile" | "flat" | "o" | "wavy" | "yawn";
type ReactionKind =
  | "annoyed"
  | "dizzy"
  | "love"
  | "surprised"
  | "wave"
  | "yawn"
  | "glance"
  | "play"
  | "stretch"
  | "hop";
type ParticleKind = "heart" | "sparkle" | "z" | "note" | "bang" | "question" | "sweat" | "rain";

/** Keadaan sekitar yang bikin Pip bereaksi pas lagi santai. */
export type PipConditions = { hot?: boolean; tired?: boolean; rain?: boolean };

const SVG_NS = "http://www.w3.org/2000/svg";
const P_PATH = "M30 45a15 15 0 0 1 15-15h17a34 34 0 0 1 0 68h-2v27a15 15 0 0 1-30 0z";
/** Titik tumpu buat gepeng/miring: ujung bawah batang P. */
const PIVOT = { x: 48, y: 140 };
const FACE = { x: 63, y: 62 };
const EYES = [
  { x: 52, y: 62 },
  { x: 74, y: 62 },
];
const DOT_REST = { x: 104, y: 26 };

// ---------------------------------------------------------------------------
// Pegas
// ---------------------------------------------------------------------------

class Spring {
  v = 0;
  target: number;
  constructor(
    public x: number,
    public k = 170,
    public d = 22,
  ) {
    this.target = x;
  }
  step(dt: number) {
    const a = this.k * (this.target - this.x) - this.d * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  kick(dv: number) {
    this.v += dv;
  }
}

// ---------------------------------------------------------------------------
// Satu detak buat semua Pip (biar nggak tiap Pip punya loop sendiri)
// ---------------------------------------------------------------------------

const engines = new Set<PipEngine>();
let rafId = 0;
let last = 0;

function frame(t: number) {
  const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
  last = t;
  // Baca posisi semua Pip dulu, baru nulis. Kalau dicampur, browser
  // kepaksa ngitung ulang layout berkali-kali tiap frame.
  engines.forEach((e) => e.measure(t / 1000));
  engines.forEach((e) => e.tick(t / 1000, dt));
  rafId = engines.size ? requestAnimationFrame(frame) : 0;
  if (!rafId) last = 0;
}

function ensureLoop() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

/**
 * Posisi kursor dalam koordinat jendela (sama kayak clientX/clientY).
 * Di notch, posisi ini dikirim Rust walaupun kursornya lagi di luar jendela,
 * jadi Pip tetap bisa ngelirik ke mana pun kursor berada.
 */
const pointer = { x: 0, y: 0, at: -100, seq: 0 };
export function setPointer(x: number, y: number) {
  if (Math.abs(x - pointer.x) < 0.5 && Math.abs(y - pointer.y) < 0.5) return;
  pointer.x = x;
  pointer.y = y;
  pointer.at = performance.now() / 1000;
  pointer.seq++;
}
/** Seberapa jauh (px) kursor dari wajah sampai Pip melirik penuh. */
const LOOK_REACH = { x: 160, y: 120 };

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

// ---------------------------------------------------------------------------
// Partikel (hati, kilau, z, not musik, tanda seru)
// ---------------------------------------------------------------------------

type Particle = {
  el: SVGElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  spin: number;
  rot: number;
  scale: number;
  orbit?: { cx: number; cy: number; r: number; a: number; speed: number };
};

const PARTICLE_PATH: Partial<Record<ParticleKind, { d: string; fill: string }>> = {
  heart: { d: "M0 3.2C-6-1-4-7.5 0-4.2 4-7.5 6-1 0 3.2z", fill: "#FF6B8B" },
  sparkle: { d: "M0-5 1.3-1.3 5 0 1.3 1.3 0 5-1.3 1.3-5 0-1.3-1.3z", fill: "#FFD66B" },
  sweat: { d: "M0-5C2 -2 3 0 3 1.6a3 3 0 0 1-6 0C-3 0-2-2 0-5z", fill: "#7CC4FF" },
  rain: { d: "M0-4C1.4-1.6 2 0 2 1.2a2 2 0 0 1-4 0C-2 0-1.4-1.6 0-4z", fill: "#8FB8FF" },
};
const PARTICLE_TEXT: Partial<Record<ParticleKind, { text: string; fill: string; size: number }>> = {
  z: { text: "z", fill: "#A3A3B5", size: 13 },
  note: { text: "♪", fill: "#C9B8FF", size: 14 },
  bang: { text: "!", fill: "#FFB340", size: 16 },
  question: { text: "?", fill: "#A99DFF", size: 15 },
};

// ---------------------------------------------------------------------------
// Mesin
// ---------------------------------------------------------------------------

/** Reaksi santai yang boleh dipotong reaksi lain (misalnya pas di-hover). */
const IDLE_REACTIONS = new Set<ReactionKind>(["love", "glance", "play", "stretch", "yawn", "hop"]);

let uidCounter = 0;

export type PipOptions = {
  /** Gerak sendiri (lirik, nguap, mainin titik) pas lagi santai. */
  autonomous?: boolean;
  /** Ikuti arah kursor global. */
  followCursor?: boolean;
  /**
   * Diam: cuma digambar ulang sebentar tiap suasana berubah, habis itu
   * berhenti. Buat Pip kecil yang banyak (avatar chat) atau reduced motion.
   */
  still?: boolean;
};

export class PipEngine {
  private svg: SVGSVGElement;
  private els: Record<string, SVGElement> = {};
  private clipRects: SVGRectElement[] = [];
  private particles: Particle[] = [];
  private uid = ++uidCounter;

  private mood: PipMood = "idle";
  private moodSince = 0;
  private badge = "";
  private opts: Required<PipOptions>;

  // Pegas
  private sx = new Spring(1, 380, 13);
  private sy = new Spring(1, 380, 13);
  private tilt = new Spring(0, 140, 14);
  private hop = new Spring(0, 260, 15);
  private lookX = new Spring(0, 90, 15);
  private lookY = new Spring(0, 90, 15);
  private lid = new Spring(1, 220, 26);
  private lidAngle = new Spring(0, 160, 22);
  private eyeScale = new Spring(1, 260, 16);
  private dotX = new Spring(DOT_REST.x, 160, 15);
  private dotY = new Spring(DOT_REST.y, 160, 15);
  private dotR = new Spring(8.5, 300, 14);
  private blush = new Spring(0.5, 60, 14);
  private yawn = new Spring(0, 120, 18);

  // Waktu
  private t = 0;
  private nextBlink = 0;
  private blinkStart = -1;
  private doubleBlink = false;
  private nextIdle = 0;
  private lastInteraction = 0;
  private reaction: { kind: ReactionKind; until: number; data?: number } | null = null;
  private taps: number[] = [];
  private shakes: number[] = [];
  private shakeDir = 0;
  private tapTimer = 0;
  private hovering = false;
  private hoverSince = 0;
  private localLook: { x: number; y: number; at: number } | null = null;
  private lastParticle = 0;
  private lastHopBeat = 0;
  private glance = { x: 0, y: 0 };
  private face = { x: 0, y: 0, ok: false };
  private measuredSeq = -1;
  private measuredAt = -10;
  private pointerLook: { x: number; y: number } | null = null;
  private skipped = 0;
  private settleUntil = 0;
  private cond: PipConditions = {};
  private lastCond = 0;

  constructor(svg: SVGSVGElement, opts: PipOptions = {}) {
    this.svg = svg;
    this.opts = { autonomous: true, followCursor: true, still: false, ...opts };
    if (this.opts.still) {
      this.opts.autonomous = false;
      this.opts.followCursor = false;
    } else {
      // Masuk sambil "plop": mulai agak gepeng, pegas yang bikin mantul.
      this.sy.x = 0.72;
      this.sx.x = 1.2;
    }
    this.build();
    this.moodSince = performance.now() / 1000;
    this.nextBlink = this.moodSince + rand(1.5, 4);
    this.nextIdle = this.moodSince + rand(3, 6);
    this.lastInteraction = this.moodSince;
    this.settleUntil = this.moodSince + 2.2;
    engines.add(this);
    ensureLoop();
  }

  /** Bangunin lagi Pip yang diam supaya perubahan kelihatan. */
  private wake() {
    if (!this.opts.still) return;
    this.settleUntil = performance.now() / 1000 + 2.2;
    engines.add(this);
    ensureLoop();
  }

  /** Dipanggil tiap frame sebelum `tick`: hitung posisi wajah di layar. */
  measure(t: number) {
    if (!this.opts.followCursor) return;
    const fresh = pointer.seq !== this.measuredSeq;
    if (!fresh && t - this.measuredAt < 0.5) return;
    this.measuredSeq = pointer.seq;
    this.measuredAt = t;
    const r = this.svg.getBoundingClientRect();
    if (!r.width) {
      this.face.ok = false;
      return;
    }
    // viewBox: x -20..150, y -32..158
    this.face = {
      x: r.left + ((FACE.x + 20) / 170) * r.width,
      y: r.top + ((FACE.y + 32) / 190) * r.height,
      ok: true,
    };
    this.pointerLook = {
      x: clamp((pointer.x - this.face.x) / LOOK_REACH.x, -1, 1),
      y: clamp((pointer.y - this.face.y) / LOOK_REACH.y, -1, 1),
    };
  }

  destroy() {
    engines.delete(this);
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.svg.replaceChildren();
  }

  // ---------------- API ----------------

  setMood(mood: PipMood) {
    if (mood === this.mood) return;
    const prev = this.mood;
    this.mood = mood;
    this.moodSince = this.t;
    this.wake();
    // Sedikit kejutan tiap ganti suasana, biar perubahannya kerasa.
    if (mood === "happy") this.hop.kick(-160);
    if (mood === "notify") {
      this.sy.kick(-2.5);
      this.sx.kick(2.5);
      this.spawn("bang", 0);
    }
    if (mood === "error") {
      this.tilt.kick(-260);
      this.spawn("sweat", 0);
    }
    if (mood === "listening") this.sy.kick(2);
    if (mood === "wave") this.hop.kick(-90);
    if (prev === "sleep" && mood !== "sleep") {
      this.sy.kick(3);
      this.spawn("question", 0);
    }
  }

  /** Panas (CPU mentok), capek (baterai lemah), hujan (dari widget cuaca). */
  setConditions(c: PipConditions) {
    if (!!c.hot === !!this.cond.hot && !!c.tired === !!this.cond.tired && !!c.rain === !!this.cond.rain) return;
    const was = this.cond;
    this.cond = { ...c };
    this.wake();
    if (c.hot && !was.hot) this.spawn("sweat", 0);
    if (c.tired && !was.tired) this.sy.kick(1.5);
  }

  setBadge(text: string | number | undefined) {
    const next = text === undefined ? "" : String(text);
    if (next === this.badge) return;
    this.badge = next;
    this.wake();
  }

  /** Arah lirikan lokal (misalnya kursor di atas Pip), -1..1. */
  lookAt(x: number, y: number) {
    this.localLook = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), at: this.t };
  }

  /**
   * Satu klik dari pengguna. Klik sekali = kesel, dua kali cepet = dadah,
   * tiga kali atau lebih = pusing. Klik pertama langsung dikasih respon
   * biar kerasa nyambung, sisanya ditentukan dari klik berikutnya.
   */
  tap() {
    const now = performance.now() / 1000;
    this.taps = [...this.taps.filter((p) => now - p < 0.42), now];
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = 0;
    const n = this.taps.length;
    if (n === 1) {
      this.poke();
    } else if (n === 2) {
      this.squish();
      this.tapTimer = window.setTimeout(() => {
        this.tapTimer = 0;
        if (this.taps.length === 2) this.wave();
      }, 300);
    } else {
      this.taps = [];
      this.dizzy();
    }
  }

  poke() {
    this.interact();
    this.squish();
    this.react("annoyed", 1.3);
    this.spawn("bang", 0);
  }

  dizzy() {
    this.interact();
    this.squish();
    this.react("dizzy", 2.8);
    for (let i = 0; i < 4; i++) this.spawnOrbit(i);
  }

  private squish() {
    this.sx.kick(3.2);
    this.sy.kick(-3.2);
    this.tilt.kick(rand(-120, 120));
  }

  wave() {
    this.interact();
    this.react("wave", 1.8);
    this.hop.kick(-110);
  }

  hover(on: boolean) {
    if (on && !this.hovering) {
      this.hoverSince = this.t;
      this.interact();
    }
    if (!on && this.reaction?.kind === "love") this.reaction = null;
    this.hovering = on;
  }

  /**
   * Notch lagi diseret: Pip ketinggalan dikit (miring ke belakang, titiknya
   * telat ngikut), dan kalau diguncang bolak-balik terus dia pusing.
   * `vx` = kecepatan geser (px per frame), positif ke kanan.
   */
  nudge(vx: number) {
    const now = performance.now() / 1000;
    this.interact();
    const v = clamp(vx, -40, 40);
    const speed = Math.abs(v);
    this.tilt.kick(-v * 8);
    this.sx.kick(speed * 0.04);
    this.sy.kick(-speed * 0.04);
    this.dotX.kick(-v * 9);
    this.dotY.kick(-speed * 2);
    this.localLook = { x: clamp(-v / 10, -1, 1), y: -0.3, at: this.t };

    const dir = Math.sign(v);
    if (speed > 5 && dir !== 0 && dir !== this.shakeDir) {
      if (this.shakeDir !== 0) this.shakes.push(now);
      this.shakeDir = dir;
    }
    this.shakes = this.shakes.filter((t) => now - t < 1.4);
    const r = this.activeReaction();
    if (this.shakes.length >= 4 && r?.kind !== "dizzy") {
      this.shakes = [];
      this.dizzy();
    } else if (!r || IDLE_REACTIONS.has(r.kind)) {
      this.react("surprised", 0.5);
    }
  }

  /** Lompat kecil (dipakai pas Pip jalan-jalan di desktop). */
  jump(power = 1) {
    this.hop.kick(-120 * power);
    this.sy.kick(-1.4 * power);
    this.sx.kick(1.0 * power);
  }

  /** Mendarat abis diseret: gepeng sebentar terus mantul. */
  land() {
    this.interact();
    this.sy.kick(-3.6);
    this.sx.kick(3.2);
    this.tilt.kick(rand(-90, 90));
  }

  surprise() {
    this.react("surprised", 0.9);
    this.sy.kick(3);
  }

  // ---------------- Bangun SVG ----------------

  private make<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attrs: Record<string, string | number>,
    parent?: SVGElement,
  ): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    (parent ?? this.svg).appendChild(el);
    return el;
  }

  private build() {
    const svg = this.svg;
    svg.replaceChildren();
    svg.setAttribute("viewBox", "-20 -32 170 190");
    svg.setAttribute("overflow", "visible");

    const defs = this.make("defs", {});
    EYES.forEach((_, i) => {
      const cp = this.make("clipPath", { id: `pip-lid-${this.uid}-${i}` }, defs);
      this.clipRects.push(this.make("rect", { x: -20, y: 0, width: 60, height: 40 }, cp));
    });

    const root = this.make("g", {});
    const body = (this.els.body = this.make("g", {}, root));
    this.make("path", { d: P_PATH, fill: "#F6F3FF" }, body);

    // Pipi
    this.els.cheekL = this.make("ellipse", { cx: 44, cy: 75, rx: 5.2, ry: 3, fill: "#F4A3C0" }, body);
    this.els.cheekR = this.make("ellipse", { cx: 82, cy: 75, rx: 5.2, ry: 3, fill: "#F4A3C0" }, body);

    // Mata
    const face = (this.els.face = this.make("g", {}, body));
    EYES.forEach((e, i) => {
      const g = this.make("g", { "clip-path": `url(#pip-lid-${this.uid}-${i})` }, face);
      this.els[`eye${i}`] = g;
      this.make("ellipse", { cx: e.x, cy: e.y, rx: 5, ry: 6.5, fill: "#15131C" }, g);
      this.make("circle", { cx: e.x + 1.6, cy: e.y - 2.4, r: 1.6, fill: "#fff" }, g);
      this.els[`closed${i}`] = this.make(
        "path",
        { d: `M${e.x - 5} ${e.y + 0.5}q5 3 10 0`, stroke: "#15131C", "stroke-width": 3, "stroke-linecap": "round", fill: "none" },
        face,
      );
    });

    const stroke = { stroke: "#15131C", "stroke-width": 3.4, "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" };
    this.els.happy = this.make("g", stroke, face);
    EYES.forEach((e) => this.make("path", { d: `M${e.x - 6} ${e.y + 2}q6-8 12 0` }, this.els.happy));
    this.els.sleep = this.make("g", stroke, face);
    EYES.forEach((e) => this.make("path", { d: `M${e.x - 6} ${e.y + 1}q6 4 12 0` }, this.els.sleep));
    this.els.xeyes = this.make("g", stroke, face);
    EYES.forEach((e) => this.make("path", { d: `M${e.x - 4} ${e.y - 4}l8 8M${e.x + 4} ${e.y - 4}l-8 8` }, this.els.xeyes));
    this.els.spiral = this.make("g", { ...stroke, "stroke-width": 2.2 }, face);
    EYES.forEach((e, i) => {
      const g = this.make("g", {}, this.els.spiral);
      this.els[`spiral${i}`] = g;
      this.make("path", { d: `M${e.x} ${e.y}m0-1a1 1 0 1 1-1 1 2 2 0 1 1 2 2 3 3 0 1 1-3-3 4 4 0 1 1 4 4` }, g);
    });
    this.els.hearts = this.make("g", { fill: "#FF4F7B" }, face);
    EYES.forEach((e) =>
      this.make("path", { d: `M${e.x} ${e.y + 4.5}C${e.x - 8} ${e.y - 1} ${e.x - 4.5} ${e.y - 8.5} ${e.x} ${e.y - 4}C${e.x + 4.5} ${e.y - 8.5} ${e.x + 8} ${e.y - 1} ${e.x} ${e.y + 4.5}z` }, this.els.hearts),
    );

    // Mulut
    this.els.mouth = this.make("path", { ...stroke, d: "" }, body);
    this.els.mouthO = this.make("ellipse", { cx: FACE.x, cy: 80, rx: 3, ry: 3.4, fill: "#15131C" }, body);

    // Titik "point"
    this.els.dotGroup = this.make("g", {}, root);
    this.els.dot = this.make("circle", { cx: DOT_REST.x, cy: DOT_REST.y, r: 8.5, fill: MOOD_COLOR.idle }, this.els.dotGroup);
    this.els.dotShine = this.make("circle", { r: 2.3, fill: "#fff", opacity: 0.7 }, this.els.dotGroup);
    this.els.badge = this.make(
      "text",
      { "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#fff", "font-family": "Segoe UI, system-ui, sans-serif" },
      this.els.dotGroup,
    );

    this.els.particles = this.make("g", {}, root);
  }

  // ---------------- Logika ----------------

  private interact() {
    this.lastInteraction = this.t;
  }

  private react(kind: ReactionKind, seconds: number, data?: number) {
    this.reaction = { kind, until: this.t + seconds, data };
  }

  private activeReaction() {
    if (this.reaction && this.reaction.until > this.t) return this.reaction;
    this.reaction = null;
    return null;
  }

  private scheduleIdle() {
    const t = this.t;
    if (!this.opts.autonomous || this.hovering || t < this.nextIdle || this.activeReaction()) return;
    this.nextIdle = t + rand(3.5, 7.5);
    if (this.mood !== "idle" && this.mood !== "music") return;

    const idleFor = t - this.lastInteraction;
    const options: [ReactionKind | "blink2", number][] = [
      ["glance", 34],
      ["blink2", 14],
      ["play", this.mood === "idle" ? 16 : 0],
      ["stretch", 10],
      ["hop", 10],
      ["yawn", idleFor > 45 ? 18 : 0],
    ];
    const total = options.reduce((s, [, w]) => s + w, 0);
    let pick = Math.random() * total;
    for (const [kind, w] of options) {
      pick -= w;
      if (pick > 0) continue;
      if (kind === "blink2") {
        this.blinkStart = t;
        this.doubleBlink = true;
      } else if (kind === "glance") {
        this.glance = { x: rand(-1, 1), y: rand(-0.8, 0.6) };
        this.react("glance", rand(0.9, 1.6));
      } else if (kind === "play") {
        this.react("play", 3.4, t);
      } else if (kind === "stretch") {
        this.react("stretch", 0.7);
      } else if (kind === "hop") {
        this.hop.kick(-140);
        this.sy.kick(-1.5);
      } else if (kind === "yawn") {
        this.react("yawn", 1.8);
      }
      break;
    }
  }

  private spawn(kind: ParticleKind, spread = 1) {
    if (this.opts.still) return;
    const base = { x: 70 + rand(-14, 14) * spread, y: 10 };
    let el: SVGElement;
    const p = PARTICLE_PATH[kind];
    if (p) {
      el = this.make("path", { d: p.d, fill: p.fill }, this.els.particles);
    } else {
      const tx = PARTICLE_TEXT[kind]!;
      el = this.make(
        "text",
        { "text-anchor": "middle", "font-size": tx.size, "font-weight": 700, fill: tx.fill, "font-family": "Segoe UI, system-ui, sans-serif" },
        this.els.particles,
      );
      el.textContent = tx.text;
    }
    if (kind === "rain") {
      this.particles.push({
        el, x: rand(-6, 136), y: rand(-34, -20), vx: -6, vy: rand(70, 95), life: 0, max: 1.5, spin: 0, rot: 0, scale: rand(0.8, 1.1),
      });
      return;
    }
    const isBang = kind === "bang" || kind === "question" || kind === "sweat";
    this.particles.push({
      el,
      x: kind === "sweat" ? 88 : isBang ? 92 : base.x,
      y: kind === "sweat" ? 40 : isBang ? 18 : base.y,
      vx: isBang ? 0 : rand(-10, 10),
      vy: isBang ? -8 : rand(-28, -18),
      life: 0,
      max: kind === "z" ? 2.4 : isBang ? 1 : 1.6,
      spin: kind === "sparkle" ? rand(-180, 180) : 0,
      rot: 0,
      scale: kind === "heart" ? rand(0.9, 1.3) : 1,
    });
  }

  private spawnOrbit(i: number) {
    if (this.opts.still) return;
    const el = this.make("path", { d: PARTICLE_PATH.sparkle!.d, fill: "#FFD66B" }, this.els.particles);
    this.particles.push({
      el, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 2.6, spin: 200, rot: 0, scale: 0.9,
      orbit: { cx: FACE.x, cy: 22, r: 26, a: (i / 4) * Math.PI * 2, speed: 4 },
    });
  }

  tick(t: number, frameDt: number) {
    this.t = t;
    if (this.opts.still && t > this.settleUntil && !this.particles.length) {
      engines.delete(this);
      return;
    }
    // Tidur: hemat tenaga, cukup ~20 fps (waktu yang dilewati tetap dihitung).
    this.skipped += frameDt;
    if (this.mood === "sleep" && this.skipped < 0.05) return;
    const dt = Math.min(0.06, this.skipped);
    this.skipped = 0;

    this.scheduleIdle();
    const r = this.activeReaction();
    const mood = this.mood;
    const since = t - this.moodSince;

    // Tahan kursor 1,8 detik = jatuh cinta.
    if (this.hovering && t - this.hoverSince > 1.8 && (!r || IDLE_REACTIONS.has(r.kind)) && mood !== "sleep") {
      this.react("love", 0.3);
    }

    // ---- Target per suasana ----
    let eyeMode: EyeMode = "open";
    let mouth: MouthMode = "none";
    let lidOpen = 1;
    let lidAngle = 0;
    let eyeScale = 1;
    let lookTarget: { x: number; y: number } | null = null;
    let dot = { x: DOT_REST.x + Math.sin(t * 1.3) * 1.5, y: DOT_REST.y + Math.sin(t * 1.9) * 1.8 };
    let dotOpacity = 1;
    let dotR = 8.5;
    let tiltTarget = 0;
    let scaleX = 1;
    let scaleY = 1;
    let breatheAmp = 0.022;
    let breathePeriod = 3.6;
    let blush = 0.5;

    switch (mood) {
      case "wave":
        eyeMode = "happy";
        mouth = "smile";
        dot = { x: 110 + Math.sin(t * 11) * 7, y: 46 + Math.cos(t * 11) * 3 };
        tiltTarget = Math.sin(t * 5.5) * 5;
        blush = 0.8;
        break;
      case "thinking": {
        lidOpen = 0.9;
        lookTarget = { x: 0.7, y: -0.8 };
        const a = t * 3.8;
        dot = { x: FACE.x + Math.cos(a) * 50, y: 60 + Math.sin(a) * 50 };
        dotR = 6.5;
        break;
      }
      case "working": {
        lidOpen = 0.78;
        lookTarget = { x: Math.sin(t * 2.4) * 0.5, y: 0.85 };
        const a = t * 6.5;
        dot = { x: FACE.x + Math.cos(a) * 48, y: 60 + Math.sin(a) * 48 };
        dotR = 6;
        tiltTarget = Math.sin(t * 9) * 1.5;
        break;
      }
      case "notify":
        eyeScale = 1.15;
        mouth = "o";
        dot = { x: DOT_REST.x, y: 20 - Math.abs(Math.sin(t * 6.5)) * 12 };
        dotR = 11;
        tiltTarget = Math.sin(t * 6.5) * 4;
        break;
      case "happy":
        eyeMode = "happy";
        mouth = "smile";
        blush = 0.95;
        if (since < 1.8 && t - this.lastHopBeat > 0.55) {
          this.lastHopBeat = t;
          this.hop.kick(-150);
          this.sy.kick(-1.2);
          this.spawn("sparkle");
        }
        dot = { x: DOT_REST.x + Math.cos(t * 5) * 4, y: DOT_REST.y + Math.sin(t * 5) * 4 };
        break;
      case "sleep":
        eyeMode = "sleep";
        dotOpacity = 0.4;
        dot = { x: 100, y: 44 };
        breatheAmp = 0.045;
        breathePeriod = 5;
        tiltTarget = 5;
        if (t - this.lastParticle > 1.7) {
          this.lastParticle = t;
          this.spawn("z", 0.4);
        }
        break;
      case "listening":
        eyeScale = 1.28;
        scaleX = 1.07;
        scaleY = 1.07;
        dotR = 8.5 + Math.sin(t * 7) * 2.2;
        mouth = "o";
        break;
      case "error":
        eyeMode = "x";
        mouth = "wavy";
        dot = { x: 100, y: 46 };
        tiltTarget = since < 0.8 ? Math.sin(t * 40) * 6 : 0;
        break;
      case "music": {
        const beat = (t * 112) / 60; // ±112 bpm
        lidOpen = 0.6;
        mouth = "smile";
        tiltTarget = Math.sin(beat * Math.PI) * 7;
        dot = { x: DOT_REST.x + Math.sin(beat * Math.PI) * 5, y: DOT_REST.y - Math.abs(Math.cos(beat * Math.PI)) * 6 };
        if (Math.floor(beat) !== Math.floor(beat - dt * (112 / 60)) && Math.floor(beat) % 2 === 0) {
          this.hop.kick(-60);
        }
        if (t - this.lastParticle > 2.2) {
          this.lastParticle = t;
          this.spawn("note");
        }
        break;
      }
      default:
        break;
    }

    // ---- Keadaan sekitar (cuma pas lagi santai) ----
    if (mood === "idle" || mood === "music") {
      const c = this.cond;
      if (c.tired) {
        lidOpen = Math.min(lidOpen, 0.5);
        breathePeriod = 4.8;
        breatheAmp = 0.035;
        tiltTarget += 3;
        dotOpacity = Math.min(dotOpacity, 0.7);
        dot = { x: dot.x, y: dot.y + 6 };
      }
      if (c.hot) {
        lidOpen = Math.min(lidOpen, 0.75);
        mouth = mouth === "none" ? "wavy" : mouth;
        if (t - this.lastCond > 2.4) {
          this.lastCond = t;
          this.spawn("sweat", 0);
        }
      }
      if (c.rain && !c.hot && t - this.lastCond > 0.35) {
        this.lastCond = t;
        this.spawn("rain");
        lookTarget ??= { x: 0, y: -0.7 };
      }
    }

    // ---- Reaksi sementara menimpa suasana ----
    if (r) {
      switch (r.kind) {
        case "annoyed":
          eyeMode = "open";
          lidOpen = 0.55;
          lidAngle = 18;
          mouth = "flat";
          blush = 0.2;
          lookTarget = { x: 0, y: 0.1 };
          break;
        case "dizzy":
          eyeMode = "spiral";
          mouth = "wavy";
          tiltTarget = Math.sin(t * 6) * 11;
          dot = { x: FACE.x + Math.cos(t * 4) * 30, y: 24 + Math.sin(t * 4) * 8 };
          break;
        case "love":
          eyeMode = "heart";
          mouth = "smile";
          blush = 1;
          scaleY = 1.03;
          if (t - this.lastParticle > 0.32) {
            this.lastParticle = t;
            this.spawn("heart");
          }
          break;
        case "surprised":
          eyeScale = 1.3;
          mouth = "o";
          break;
        case "wave":
          eyeMode = "happy";
          mouth = "smile";
          blush = 0.85;
          dot = { x: 110 + Math.sin(t * 12) * 8, y: 46 + Math.cos(t * 12) * 3 };
          tiltTarget = Math.sin(t * 6) * 5;
          break;
        case "yawn": {
          const p = 1 - (r.until - t) / 1.8;
          lidOpen = p < 0.7 ? 0.25 : 1;
          mouth = "yawn";
          scaleY = p < 0.7 ? 1.08 : 1;
          scaleX = p < 0.7 ? 0.95 : 1;
          tiltTarget = -4;
          break;
        }
        case "glance":
          lookTarget = this.glance;
          break;
        case "play": {
          const p = t - (r.data ?? t);
          const a = p * 2.6;
          dot = { x: FACE.x + Math.sin(a) * 52, y: 40 + Math.sin(a * 2) * 26 };
          lookTarget = { x: (dot.x - FACE.x) / 45, y: (dot.y - FACE.y) / 40 };
          mouth = "smile";
          break;
        }
        case "stretch":
          scaleY = 1.13;
          scaleX = 0.92;
          lidOpen = 0.6;
          break;
        case "hop":
          break;
      }
    }

    // ---- Arah lirikan: reaksi/suasana > kursor > lirikan acak > lurus ----
    if (!lookTarget) {
      const local = this.localLook && t - this.localLook.at < 1.5 ? this.localLook : null;
      const global = this.opts.followCursor && this.face.ok && t - pointer.at < 8 ? this.pointerLook : null;
      lookTarget = local ?? global ?? { x: 0, y: 0 };
    }
    if (mood === "sleep") lookTarget = { x: 0, y: 0.2 };

    // ---- Kedip ----
    if (!this.opts.still && t >= this.nextBlink && this.blinkStart < 0 && eyeMode === "open") {
      this.blinkStart = t;
      this.doubleBlink = Math.random() < 0.18;
    }
    let blinkClose = 0;
    if (this.blinkStart >= 0) {
      const p = (t - this.blinkStart) / 0.17;
      if (p >= 1) {
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.blinkStart = t + 0.06;
        } else {
          this.blinkStart = -1;
          this.nextBlink = t + rand(2.2, 6);
        }
      } else if (p > 0) {
        blinkClose = Math.sin(Math.PI * p);
      }
    }

    // ---- Jalankan pegas ----
    this.sx.target = scaleX;
    this.sy.target = scaleY;
    // Badannya ikut condong dikit ke arah yang dilirik.
    this.tilt.target = tiltTarget + clamp(lookTarget.x, -1, 1) * 3;
    this.lookX.target = lookTarget.x;
    this.lookY.target = lookTarget.y;
    this.lid.target = lidOpen;
    this.lidAngle.target = lidAngle;
    this.eyeScale.target = eyeScale;
    this.dotX.target = dot.x;
    this.dotY.target = dot.y;
    this.dotR.target = dotR;
    this.blush.target = blush;
    this.yawn.target = mouth === "yawn" ? 1 : 0;
    for (const s of [this.sx, this.sy, this.tilt, this.hop, this.lookX, this.lookY, this.lid, this.lidAngle, this.eyeScale, this.dotX, this.dotY, this.dotR, this.blush, this.yawn]) {
      s.step(dt);
    }
    // Lompatan nggak boleh tembus lantai.
    if (this.hop.x > 0) {
      this.hop.x = 0;
      if (this.hop.v > 40) {
        // Pas mendarat: gepeng sebentar.
        this.sy.kick(-this.hop.v * 0.012);
        this.sx.kick(this.hop.v * 0.012);
      }
      this.hop.v = 0;
    }

    this.render(t, eyeMode, mouth, blinkClose, breatheAmp, breathePeriod, dotOpacity);
    this.updateParticles(dt);
  }

  private render(
    t: number,
    eyeMode: EyeMode,
    mouth: MouthMode,
    blinkClose: number,
    breatheAmp: number,
    breathePeriod: number,
    dotOpacity: number,
  ) {
    const breathe = 1 + Math.sin((t / breathePeriod) * Math.PI * 2) * breatheAmp;
    const sx = this.sx.x * (2 - breathe);
    const sy = this.sy.x * breathe;
    const P = PIVOT;
    this.els.body.setAttribute(
      "transform",
      `translate(0 ${this.hop.x.toFixed(2)}) translate(${P.x} ${P.y}) rotate(${this.tilt.x.toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(${-P.x} ${-P.y})`,
    );

    // Wajah bergeser ngikutin lirikan
    const lx = clamp(this.lookX.x, -1.2, 1.2) * 4.6;
    const ly = clamp(this.lookY.x, -1.2, 1.2) * 3.8;
    const es = this.eyeScale.x;
    this.els.face.setAttribute(
      "transform",
      `translate(${lx.toFixed(2)} ${ly.toFixed(2)}) translate(${FACE.x} ${FACE.y}) scale(${es.toFixed(3)}) translate(${-FACE.x} ${-FACE.y})`,
    );

    // Kelopak mata
    const open = clamp(this.lid.x * (1 - blinkClose), 0, 1.2);
    const showOpen = eyeMode === "open";
    EYES.forEach((e, i) => {
      const lidY = e.y - 7 + (1 - open) * 13.5;
      const angle = (i === 0 ? 1 : -1) * this.lidAngle.x;
      const rect = this.clipRects[i];
      rect.setAttribute("x", String(e.x - 20));
      rect.setAttribute("y", lidY.toFixed(2));
      rect.setAttribute("transform", `rotate(${angle.toFixed(2)} ${e.x} ${e.y})`);
      this.els[`eye${i}`].setAttribute("opacity", showOpen && open > 0.14 ? "1" : "0");
      this.els[`closed${i}`].setAttribute("opacity", showOpen && open <= 0.14 ? "1" : "0");
    });
    const modeEls: Record<Exclude<EyeMode, "open">, SVGElement> = {
      happy: this.els.happy,
      sleep: this.els.sleep,
      x: this.els.xeyes,
      spiral: this.els.spiral,
      heart: this.els.hearts,
    };
    for (const [m, el] of Object.entries(modeEls)) el.setAttribute("opacity", eyeMode === m ? "1" : "0");
    if (eyeMode === "spiral") {
      EYES.forEach((e, i) => this.els[`spiral${i}`].setAttribute("transform", `rotate(${(t * 360 * (i ? -1 : 1)) % 360} ${e.x} ${e.y}) translate(${e.x} ${e.y}) scale(1.35) translate(${-e.x} ${-e.y})`));
    }
    if (eyeMode === "heart") {
      const pulse = 1 + Math.sin(t * 10) * 0.08;
      this.els.hearts.setAttribute("transform", `translate(${FACE.x} ${FACE.y}) scale(${pulse}) translate(${-FACE.x} ${-FACE.y})`);
    }

    // Mulut
    const m = this.els.mouth;
    const yawn = this.yawn.x;
    const mouthPaths: Record<MouthMode, string> = {
      none: "",
      smile: "M58 78q5 5 10 0",
      flat: "M59 79.5h8",
      o: "",
      wavy: "M55 80q2-3 4 0t4 0 4 0 4 0",
      yawn: "",
    };
    m.setAttribute("d", mouthPaths[mouth]);
    const o = this.els.mouthO;
    if (mouth === "o" || yawn > 0.05) {
      o.setAttribute("opacity", "1");
      o.setAttribute("rx", (mouth === "o" ? 3 : 3 + yawn * 2).toFixed(2));
      o.setAttribute("ry", (mouth === "o" ? 3.4 : 2 + yawn * 4.5).toFixed(2));
      o.setAttribute("cy", (mouth === "o" ? 80 : 80 + yawn).toFixed(2));
    } else {
      o.setAttribute("opacity", "0");
    }

    // Pipi
    const b = clamp(this.blush.x, 0, 1);
    this.els.cheekL.setAttribute("opacity", (b * 0.75).toFixed(2));
    this.els.cheekR.setAttribute("opacity", (b * 0.75).toFixed(2));

    // Titik
    const color = MOOD_COLOR[this.mood];
    const dx = this.dotX.x;
    const dy = this.dotY.x + this.hop.x * 0.4;
    const dr = Math.max(3, this.dotR.x + (this.badge ? 2.5 : 0));
    this.els.dot.setAttribute("cx", dx.toFixed(2));
    this.els.dot.setAttribute("cy", dy.toFixed(2));
    this.els.dot.setAttribute("r", dr.toFixed(2));
    this.els.dot.setAttribute("fill", color);
    this.els.dotGroup.setAttribute("opacity", String(dotOpacity));
    this.els.dotShine.setAttribute("cx", (dx - dr * 0.3).toFixed(2));
    this.els.dotShine.setAttribute("cy", (dy - dr * 0.3).toFixed(2));
    this.els.dotShine.setAttribute("opacity", this.badge ? "0" : "0.7");
    this.els.badge.textContent = this.badge;
    this.els.badge.setAttribute("x", dx.toFixed(2));
    this.els.badge.setAttribute("y", (dy + 4).toFixed(2));
  }

  private updateParticles(dt: number) {
    this.particles = this.particles.filter((p) => {
      p.life += dt;
      if (p.life >= p.max) {
        p.el.remove();
        return false;
      }
      const k = p.life / p.max;
      if (p.orbit) {
        p.orbit.a += p.orbit.speed * dt;
        p.x = p.orbit.cx + Math.cos(p.orbit.a) * p.orbit.r;
        p.y = p.orbit.cy + Math.sin(p.orbit.a) * p.orbit.r * 0.35;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.98;
      }
      p.rot += p.spin * dt;
      const pop = k < 0.15 ? k / 0.15 : 1;
      const scale = p.scale * (0.6 + 0.4 * pop);
      const opacity = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      p.el.setAttribute("transform", `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.rot.toFixed(1)}) scale(${scale.toFixed(2)})`);
      p.el.setAttribute("opacity", opacity.toFixed(2));
      return true;
    });
  }
}
