import type { LiveInfo } from "../widgets/data";

/** Yang lagi kejadian di notch, dikirim jendela utama ke Pip desktop. */
export type PetContext = {
  music: { title: string; artist: string } | null;
  /** Claude (chat atau terminal) lagi kerja. */
  claude: boolean;
  /** Timer fokus lagi jalan di fase fokus. */
  focus: boolean;
  /** Udah waktunya minum. */
  waterDue: boolean;
};

export type PetLive = { info: (LiveInfo & { id: string }) | null; offset: number };

export type PetCond = { hot: boolean; tired: boolean; rain: boolean };

export const EMPTY_CONTEXT: PetContext = { music: null, claude: false, focus: false, waterDue: false };

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** Kalimat sapaan sesuai jam. */
function byTime(h: number): string[] {
  if (h >= 4 && h < 10) return ["Pagi! Udah sarapan belum?", "Pagi cuy, gas hari ini 💪", "Bangun pagi, mantap"];
  if (h >= 10 && h < 15) return ["Siang-siang gini enaknya ngopi", "Jangan lupa makan siang ya", "Semangat, setengah hari lagi"];
  if (h >= 15 && h < 18) return ["Sore nih, istirahat bentar napa", "Udah sore aja ya"];
  if (h >= 18 && h < 22) return ["Malem, masih ngoding?", "Udah makan malem belum?"];
  return ["Udah malem banget lho…", "Jangan begadang mulu 😴", "Besok masih ada hari, tidur yuk"];
}

const IDLE = [
  "Lagi ngapain?",
  "Bosen… klik kanan gue, ajak main dong",
  "Gue di sini kalau butuh 👋",
  "Pssst, gue bisa dilempar lho",
  "Elus gue dong, gosok-gosok kursornya",
  "Coba taruh gue di atas jendela",
  "Hmm hmm hmm 🎵",
];

/** Satu kalimat buat obrolan rutin, nyesuain keadaan. Null = mending diem. */
export function chatter(ctx: PetContext, cond: PetCond, live: PetLive["info"]): string | null {
  // Lagi fokus: jangan ganggu.
  if (ctx.focus) return null;
  if (cond.tired) return pick(["Baterai mau habis, colokin dong 🔌", "Lemes… baterainya tinggal dikit"]);
  if (cond.hot) return pick(["CPU-nya panas, gue keringetan nih 🥵", "Laptop lu lagi kerja keras ya"]);
  if (ctx.waterDue) return pick(["Minum dulu yuk 💧", "Udah minum belum? Klik kanan gue buat nyatet"]);
  if (live && live.priority >= 3) return `${live.label}: ${live.value}`;
  const r = Math.random();
  if (ctx.claude && r < 0.6) return pick(["Claude lagi ngerjain, sabar ya", "Gue bantuin ngetik 💻", "Kerjaannya jalan nih"]);
  if (ctx.music && r < 0.6) {
    return pick([`"${ctx.music.title}" enak nih 🎶`, "Lagunya mantep", "Joget dulu ah 🕺"]);
  }
  if (cond.rain && r < 0.5) return "Di luar hujan, sedia payung ☔";
  if (r < 0.35) return pick(byTime(new Date().getHours()));
  return pick(IDLE);
}

/** Kalimat buat kejadian tertentu. */
export const EVENT_LINES = {
  thrown: ["Waaaa!", "Wiiiii~", "Terbaaaang!"],
  dizzy: ["Pusiiing…", "Dunia muter-muter 😵"],
  bonk: ["Aduh!", "Nabrak!", "Ouch"],
  perch: ["Pemandangan bagus dari sini 👀", "Nangkring dulu ah", "Kursi baru nih"],
  fall: ["Eh eh eh!", "Woy, jendelanya ilang!"],
  pet: ["Hehe geli 😆", "Enak… lagi dong", "Purrr~"],
  drink: ["Glek glek… seger! 💧", "Makasih, udah dicatet"],
  wake: ["Eh, udah balik?", "Hoaaam… pagi", "Gue nggak tidur kok"],
  sleep: ["Tidur bentar ya… zzz", "Ngantuk…"],
  play: ["Main bola yuk! ⚽", "Tangkep!"],
  climb: ["Manjat ah", "Pemandangan dari atas"],
  hello: ["Halo! Gue di sini sekarang", "Desktop baru, asik"],
} as const;

export function eventLine(kind: keyof typeof EVENT_LINES): string {
  return pick([...EVENT_LINES[kind]]);
}
