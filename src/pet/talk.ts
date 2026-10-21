import type { LiveInfo } from "../widgets/data";
import { isEn, tr } from "../i18n";

/** Yang lagi kejadian di notch, dikirim jendela utama ke Pip desktop. */
export type PetContext = {
  music: { title: string; artist: string; video?: boolean } | null;
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
/** Daftar kalimat sesuai bahasa yang aktif. */
const L = (id: string[], en: string[]) => (isEn() ? en : id);

/** Kalimat sapaan sesuai jam. */
function byTime(h: number): string[] {
  if (h >= 4 && h < 10)
    return L(["Pagi! Udah sarapan belum?", "Pagi cuy, gas hari ini 💪", "Bangun pagi, mantap"], ["Morning! Had breakfast yet?", "Morning! Let's crush today 💪", "Early bird, nice"]);
  if (h >= 10 && h < 15)
    return L(["Siang-siang gini enaknya ngopi", "Jangan lupa makan siang ya", "Semangat, setengah hari lagi"], ["Perfect time for a coffee", "Don't forget lunch", "Half the day to go, keep it up"]);
  if (h >= 15 && h < 18) return L(["Sore nih, istirahat bentar napa", "Udah sore aja ya"], ["It's late afternoon, take a short break", "Wow, afternoon already"]);
  if (h >= 18 && h < 22) return L(["Malem, masih ngoding?", "Udah makan malem belum?"], ["Evening! Still coding?", "Had dinner yet?"]);
  return L(["Udah malem banget lho…", "Jangan begadang mulu 😴", "Besok masih ada hari, tidur yuk"], ["It's really late…", "Don't stay up too late 😴", "Tomorrow's another day, let's sleep"]);
}

const IDLE = () =>
  L(
    [
      "Lagi ngapain?",
      "Bosen… klik kanan gue, ajak main dong",
      "Gue di sini kalau butuh 👋",
      "Pssst, gue bisa dilempar lho",
      "Elus gue dong, gosok-gosok kursornya",
      "Coba taruh gue di atas jendela",
      "Hmm hmm hmm 🎵",
    ],
    [
      "What are you up to?",
      "Bored… right-click me and let's play",
      "I'm here if you need me 👋",
      "Psst, you can throw me, you know",
      "Pet me! Rub the cursor over me",
      "Try putting me on top of a window",
      "Hmm hmm hmm 🎵",
    ],
  );

/** Satu kalimat buat obrolan rutin, nyesuain keadaan. Null = mending diem. */
export function chatter(ctx: PetContext, cond: PetCond, live: PetLive["info"]): string | null {
  // Lagi fokus: jangan ganggu.
  if (ctx.focus) return null;
  if (cond.tired) return pick(L(["Baterai mau habis, colokin dong 🔌", "Lemes… baterainya tinggal dikit"], ["Battery's almost out, plug me in 🔌", "So weak… the battery is low"]));
  if (cond.hot) return pick(L(["CPU-nya panas, gue keringetan nih 🥵", "Laptop lu lagi kerja keras ya"], ["The CPU is hot, I'm sweating 🥵", "Your PC is working hard"]));
  if (ctx.waterDue) return pick(L(["Minum dulu yuk 💧", "Udah minum belum? Klik kanan gue buat nyatet"], ["Time for some water 💧", "Had water yet? Right-click me to log it"]));
  if (live && live.priority >= 3) return `${live.label}: ${live.value}`;
  const r = Math.random();
  if (ctx.claude && r < 0.6) return pick(L(["Claude lagi ngerjain, sabar ya", "Gue bantuin ngetik 💻", "Kerjaannya jalan nih"], ["Claude is on it, hang tight", "I'm helping type 💻", "Work in progress"]));
  if (ctx.music?.video && r < 0.6) {
    const t = ctx.music.title;
    return pick(
      L(
        [`Seru nih "${t}" 🍿`, "Ssst, lagi seru-serunya", "Popcorn-nya tinggal dikit nih", "Jangan di-skip ya!", "Abis ini satu episode lagi? 👀"],
        [`"${t}" is so good 🍿`, "Shh, it's getting good", "Running low on popcorn", "Don't skip it!", "One more episode after this? 👀"],
      ),
    );
  }
  if (ctx.music && r < 0.6) {
    const t = ctx.music.title;
    return pick(L([`"${t}" enak nih 🎶`, "Lagunya mantep", "Joget dulu ah 🕺"], [`"${t}" is a bop 🎶`, "Great song", "Time to dance 🕺"]));
  }
  if (cond.rain && r < 0.5) return tr("Di luar hujan, sedia payung ☔", "It's raining outside, grab an umbrella ☔");
  if (r < 0.35) return pick(byTime(new Date().getHours()));
  return pick(IDLE());
}

/** Kalimat buat kejadian tertentu. */
export const EVENT_LINES = {
  thrown: L(["Waaaa!", "Wiiiii~", "Terbaaaang!"], ["Waaaa!", "Wheeee~", "I'm flyiiing!"]),
  dizzy: L(["Pusiiing…", "Dunia muter-muter 😵"], ["So dizzy…", "The world is spinning 😵"]),
  bonk: L(["Aduh!", "Nabrak!", "Ouch"], ["Ow!", "Bonk!", "Ouch"]),
  perch: L(["Pemandangan bagus dari sini 👀", "Nangkring dulu ah", "Kursi baru nih"], ["Nice view from up here 👀", "Gonna perch here", "New seat!"]),
  fall: L(["Eh eh eh!", "Woy, jendelanya ilang!"], ["Whoa whoa whoa!", "Hey, where'd the window go?!"]),
  pet: L(["Hehe geli 😆", "Enak… lagi dong", "Purrr~"], ["Hehe that tickles 😆", "Nice… more please", "Purrr~"]),
  drink: L(["Glek glek… seger! 💧", "Makasih, udah dicatet"], ["Gulp gulp… refreshing! 💧", "Thanks, logged it"]),
  wake: L(["Eh, udah balik?", "Hoaaam… pagi", "Gue nggak tidur kok"], ["Oh, you're back?", "Yaaawn… morning", "I wasn't sleeping, promise"]),
  sleep: L(["Tidur bentar ya… zzz", "Ngantuk…"], ["Quick nap… zzz", "So sleepy…"]),
  play: L(["Main bola yuk! ⚽", "Tangkep!"], ["Let's play ball! ⚽", "Catch!"]),
  climb: L(["Manjat ah", "Pemandangan dari atas"], ["Climbing time", "The view from the top"]),
  hello: L(["Halo! Gue di sini sekarang", "Desktop baru, asik"], ["Hi! I live here now", "New desktop, cool"]),
  lookup: L(["Hm? Ada apa?", "Apa tuh?", "Mau ngajak main?"], ["Hm? What's up?", "What's that?", "Wanna play?"]),
  pounceHit: L(["Hap! Dapet!", "Ketangkep!", "Hehe kena"], ["Gotcha!", "Caught it!", "Hehe got you"]),
  pounceMiss: L(["Meleset…", "Hampir!", "Licin banget"], ["Missed…", "So close!", "Slippery!"]),
  dodge: L(["Eits!", "Hampir kena!", "Nggak kena wleee"], ["Nope!", "That was close!", "Missed me, nyeh"]),
  chaseStart: L(["Kejar-kejaran! 🏃", "Siap-siap ya!"], ["Chase time! 🏃", "Get ready!"]),
  chaseEnd: L(["Hah… hah… seru!", "Capek, udahan dulu ya", "Lagi kapan-kapan!"], ["Phew… that was fun!", "I'm tired, let's stop", "Again some other time!"]),
  touch: L(["Kena!", "Dapet!", "Hehe"], ["Tag!", "Got it!", "Hehe"]),
  watch: L(["Nonton? Gue ambil popcorn dulu 🍿", "Ikutan nonton dong", "Kacamata siap, popcorn siap 🍿"], ["Movie time? Let me grab popcorn 🍿", "Can I watch too?", "Glasses on, popcorn ready 🍿"]),
  smell: L(["Nyam? Itu buat gue?", "Wah, makanan?"], ["Yum? Is that for me?", "Ooh, food?"]),
};

export function eventLine(kind: keyof typeof EVENT_LINES): string {
  return pick([...EVENT_LINES[kind]]);
}

/** Komentar pas dikasih makan file, nyesuain jenisnya. */
export function fileComment(paths: string[]): string {
  if (paths.length > 3) return pick(L([`Nyam nyam… ${paths.length} sekaligus, kenyang!`, "Rakus juga gue ya 😋"], [`Nom nom… ${paths.length} at once, I'm stuffed!`, "Guess I'm greedy 😋"]));
  const name = paths[0].split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!ext) return pick(L(["Satu folder utuh, kenyang 📁", "Nyam, foldernya renyah"], ["A whole folder, I'm full 📁", "Yum, crunchy folder"]));
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"].includes(ext)) return pick(L(["Wih foto siapa nih 👀", "Gambarnya enak dipandang, nyam"], ["Ooh, whose photo is this? 👀", "Easy on the eyes, yum"]));
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return pick(L(["Keras banget, susah dikunyah", "Isinya banyak nih kayaknya"], ["So hard to chew", "Feels like there's a lot inside"]));
  if (["exe", "msi", "bat", "cmd"].includes(ext)) return pick(L(["Hmm… curiga 🤨", "Ini aman kan?"], ["Hmm… suspicious 🤨", "This is safe, right?"]));
  if (["mp3", "wav", "flac", "m4a"].includes(ext)) return pick(L(["Ada lagunya! 🎶", "Nyam, renyah kayak bass"], ["It has a tune! 🎶", "Yum, crunchy like bass"]));
  if (["mp4", "mkv", "mov", "avi"].includes(ext)) return pick(L(["Film! Nonton bareng yuk 🍿", "Videonya gurih"], ["A movie! Watch it with me 🍿", "Tasty video"]));
  if (["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx"].includes(ext)) return pick(L(["Dokumen penting nih, berat 📄", "Bacaan berat, nyam"], ["Important document, heavy 📄", "Heavy reading, yum"]));
  if (["ts", "tsx", "js", "rs", "py", "html", "css", "json"].includes(ext)) return pick(L(["Kode! Rasanya kayak bug 🐛", "Nyam, semoga nggak error"], ["Code! Tastes like bugs 🐛", "Yum, hope it compiles"]));
  return pick(L(["Nyam! Makasih 😋", "Enak, ada lagi?"], ["Yum! Thanks 😋", "Tasty, got more?"]));
}
