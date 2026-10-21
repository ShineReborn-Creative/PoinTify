import type { ComponentType } from "react";
import type { IconName } from "../components/Icon";
import type { PipMood } from "../components/Pip";
import { CustomLive, CustomWidget } from "./custom";
import { DEFAULT_PROMPTS, PromptsWidget, SessionsWidget, UsageLive, UsageWidget } from "./claude";
import type { WidgetProps } from "./common";
import { defaultCity } from "./data";
import { CURRENCIES, CurrencyWidget, GithubWidget, PrayerLive, PrayerWidget, WeatherWidget } from "./info";
import { LauncherConfig, LauncherWidget } from "./launcher";
import type { WidgetItem, WidgetSize } from "./layout";
import { MusicWidget, PipWidget } from "./media";
import { ClipboardWidget, NOTE_COLORS, NoteWidget, TimerWidget, TodoWidget, WaterWidget } from "./productivity";
import { NetworkWidget, SystemLive, SystemWidget, TogglesWidget } from "./system";
import { CalendarWidget, ClockWidget, CountdownLive, CountdownWidget, TIMEZONES } from "./time";

export type Field =
  | { key: string; label: string; kind: "text"; placeholder?: string; hint?: string }
  | { key: string; label: string; kind: "textarea"; placeholder?: string; hint?: string }
  | { key: string; label: string; kind: "number"; min?: number; max?: number; hint?: string }
  | { key: string; label: string; kind: "datetime"; hint?: string }
  | { key: string; label: string; kind: "toggle"; hint?: string }
  | { key: string; label: string; kind: "select"; options: [string, string][]; hint?: string };

export type Group = "Waktu" | "Produktif" | "Media" | "Sistem" | "Info" | "Claude" | "Lainnya";
export const GROUPS: Group[] = ["Waktu", "Produktif", "Claude", "Media", "Sistem", "Info", "Lainnya"];

type Props = WidgetProps & { mood: PipMood };

export type WidgetDef = {
  type: string;
  name: string;
  desc: string;
  icon: IconName;
  group: Group;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  defaultCfg?: Record<string, unknown>;
  fields?: Field[];
  /** Editor khusus di panel pengaturan (di bawah field biasa). */
  Config?: ComponentType<{ item: WidgetItem }>;
  Component: ComponentType<Props>;
  /** Pemantau buat notch kecil (kalau widget ini bisa "Live"). */
  Live?: ComponentType<WidgetProps>;
  /** Penjelasan Live di panel pengaturan. */
  liveHint?: string;
  /** Satu aja boleh dipasang. */
  single?: boolean;
};

const LOC: Field = {
  key: "loc",
  label: "Lokasi",
  kind: "select",
  options: [
    ["auto", "Lokasi PC (otomatis)"],
    ["city", "Kota yang gue ketik"],
  ],
  hint: "Otomatis pakai layanan lokasi Windows. Kalau lokasinya mati, pakai kota di bawah.",
};
const CITY: Field = { key: "city", label: "Kota", kind: "text", placeholder: defaultCity(), hint: "Kosongin buat pakai kota dari zona waktu PC." };

export const WIDGETS: WidgetDef[] = [
  // Waktu
  {
    type: "clock",
    name: "Jam",
    desc: "Jam sekarang, bisa tambah zona waktu kedua.",
    icon: "clock",
    group: "Waktu",
    sizes: ["s", "w"],
    defaultSize: "s",
    fields: [
      { key: "tz2", label: "Zona kedua", kind: "select", options: [["", "Nggak usah"], ...TIMEZONES] },
      { key: "seconds", label: "Tampilin detik", kind: "toggle" },
    ],
    Component: ClockWidget,
  },
  {
    type: "calendar",
    name: "Kalender",
    desc: "Tanggal hari ini atau sebulan penuh.",
    icon: "calendar",
    group: "Waktu",
    sizes: ["s", "l"],
    defaultSize: "l",
    Component: CalendarWidget,
  },
  {
    type: "countdown",
    name: "Hitung mundur",
    desc: "Berapa lama lagi ke acara penting. Live pas tinggal sejam.",
    icon: "hourglass",
    group: "Waktu",
    sizes: ["s", "w"],
    defaultSize: "s",
    defaultCfg: { title: "Deadline" },
    fields: [
      { key: "title", label: "Nama acara", kind: "text", placeholder: "Deadline" },
      { key: "target", label: "Waktunya", kind: "datetime" },
    ],
    Component: CountdownWidget,
    Live: CountdownLive,
    liveHint: "Nongol di notch pas tinggal 60 menit.",
  },
  // Produktif
  {
    type: "todo",
    name: "To-do",
    desc: "Daftar kerjaan singkat, centang langsung dari notch.",
    icon: "checklist",
    group: "Produktif",
    sizes: ["w", "l"],
    defaultSize: "l",
    fields: [{ key: "title", label: "Judul", kind: "text", placeholder: "To-do" }],
    Component: TodoWidget,
  },
  {
    type: "note",
    name: "Catatan",
    desc: "Sticky note buat coretan cepat.",
    icon: "note",
    group: "Produktif",
    sizes: ["s", "w", "l"],
    defaultSize: "w",
    fields: [{ key: "color", label: "Warna", kind: "select", options: NOTE_COLORS }],
    Component: NoteWidget,
  },
  {
    type: "clipboard",
    name: "Riwayat clipboard",
    desc: "Teks yang barusan lu copy, klik buat copy lagi.",
    icon: "clipboard",
    group: "Produktif",
    sizes: ["w", "l"],
    defaultSize: "l",
    Component: ClipboardWidget,
    single: true,
  },
  {
    type: "timer",
    name: "Timer fokus",
    desc: "Pomodoro yang sama kayak tab Timer.",
    icon: "timer",
    group: "Produktif",
    sizes: ["s", "w"],
    defaultSize: "s",
    Component: TimerWidget,
    single: true,
  },
  {
    type: "water",
    name: "Minum air",
    desc: "Catat gelas air hari ini.",
    icon: "drop",
    group: "Produktif",
    sizes: ["s", "w"],
    defaultSize: "s",
    Component: WaterWidget,
    single: true,
  },
  {
    type: "launcher",
    name: "Peluncur",
    desc: "Buka app, folder, atau link favorit sekali klik.",
    icon: "rocket",
    group: "Produktif",
    sizes: ["s", "w", "l"],
    defaultSize: "w",
    Config: LauncherConfig,
    Component: LauncherWidget,
  },
  // Claude
  {
    type: "usage",
    name: "Usage Claude",
    desc: "Hitung mundur reset usage, plus notif pas udah reset.",
    icon: "sparkle",
    group: "Claude",
    sizes: ["s", "w"],
    defaultSize: "w",
    defaultCfg: { cycleHours: 5 },
    fields: [
      { key: "resetAt", label: "Jam reset berikutnya", kind: "datetime", hint: "Liat di claude.ai › Settings › Usage." },
      { key: "cycleHours", label: "Siklus (jam)", kind: "number", min: 1, max: 168 },
    ],
    Component: UsageWidget,
    Live: UsageLive,
    liveHint: "Nongol di notch 10 menit sebelum reset.",
    single: true,
  },
  {
    type: "prompts",
    name: "Prompt cepat",
    desc: "Tombol prompt siap pakai. {clipboard} diganti teks yang lagi dicopy.",
    icon: "sparkle",
    group: "Claude",
    sizes: ["w", "l"],
    defaultSize: "w",
    defaultCfg: { prompts: DEFAULT_PROMPTS },
    fields: [
      {
        key: "prompts",
        label: "Daftar prompt",
        kind: "textarea",
        hint: "Satu baris satu prompt: Nama | isi prompt. Tulis \\n buat ganti baris.",
      },
    ],
    Component: PromptsWidget,
  },
  {
    type: "sessions",
    name: "Sesi Claude",
    desc: "Ringkasan sesi Claude yang lagi kerja.",
    icon: "terminal",
    group: "Claude",
    sizes: ["w"],
    defaultSize: "w",
    Component: SessionsWidget,
    single: true,
  },
  // Media
  {
    type: "music",
    name: "Musik",
    desc: "Lagu yang lagi diputer, lengkap sama lirik.",
    icon: "music",
    group: "Media",
    sizes: ["w", "l", "xl"],
    defaultSize: "xl",
    Component: MusicWidget,
    single: true,
  },
  {
    type: "pip",
    name: "Pip",
    desc: "Pip nongkrong di Beranda. Bisa diseret keluar ke desktop.",
    icon: "sparkle",
    group: "Media",
    sizes: ["s", "l"],
    defaultSize: "s",
    Component: PipWidget,
    single: true,
  },
  // Sistem
  {
    type: "system",
    name: "Sistem",
    desc: "CPU, RAM, disk, baterai. Live kalau ada yang kritis.",
    icon: "cpu",
    group: "Sistem",
    sizes: ["s", "w"],
    defaultSize: "w",
    Component: SystemWidget,
    Live: SystemLive,
    liveHint: "Nongol di notch pas baterai lemah, CPU/RAM mentok, atau disk mau penuh.",
  },
  {
    type: "network",
    name: "Internet",
    desc: "Kecepatan unduh dan unggah sekarang.",
    icon: "wifi",
    group: "Sistem",
    sizes: ["s", "w"],
    defaultSize: "s",
    Component: NetworkWidget,
  },
  {
    type: "toggles",
    name: "Tombol cepat",
    desc: "Volume, mic, dan mode tenang.",
    icon: "volume",
    group: "Sistem",
    sizes: ["w"],
    defaultSize: "w",
    Component: TogglesWidget,
    single: true,
  },
  // Info
  {
    type: "weather",
    name: "Cuaca",
    desc: "Cuaca sekarang dan beberapa jam ke depan.",
    icon: "sun",
    group: "Info",
    sizes: ["s", "w", "l"],
    defaultSize: "s",
    fields: [LOC, CITY],
    Component: WeatherWidget,
  },
  {
    type: "prayer",
    name: "Jadwal sholat",
    desc: "Waktu sholat hari ini. Live pas mendekati waktunya.",
    icon: "moon",
    group: "Info",
    sizes: ["s", "w"],
    defaultSize: "w",
    fields: [LOC, CITY],
    Component: PrayerWidget,
    Live: PrayerLive,
    liveHint: "Nongol di notch 15 menit sebelum waktu sholat.",
  },
  {
    type: "currency",
    name: "Kurs",
    desc: "Nilai tukar mata uang hari ini.",
    icon: "money",
    group: "Info",
    sizes: ["s", "w"],
    defaultSize: "s",
    defaultCfg: { base: "USD", quote: "IDR" },
    fields: [
      { key: "base", label: "Dari", kind: "select", options: CURRENCIES.map((c) => [c, c]) },
      { key: "quote", label: "Ke", kind: "select", options: CURRENCIES.map((c) => [c, c]) },
    ],
    Component: CurrencyWidget,
  },
  {
    type: "github",
    name: "GitHub",
    desc: "Bintang, fork, issue, dan rilis terbaru repo lu.",
    icon: "star",
    group: "Info",
    sizes: ["s", "w"],
    defaultSize: "w",
    defaultCfg: { repo: "ShineReborn-Creative/PoinTify" },
    fields: [{ key: "repo", label: "Repo", kind: "text", placeholder: "pemilik/nama-repo" }],
    Component: GithubWidget,
  },
  // Lainnya
  {
    type: "custom",
    name: "Kustom (JSON)",
    desc: "Ambil satu angka atau teks dari API JSON mana aja.",
    icon: "plug",
    group: "Lainnya",
    sizes: ["s", "w"],
    defaultSize: "s",
    defaultCfg: { every: 60 },
    fields: [
      { key: "label", label: "Judul", kind: "text", placeholder: "Harga Bitcoin" },
      { key: "url", label: "Alamat API", kind: "text", placeholder: "https://api.contoh.com/data.json" },
      { key: "path", label: "Jalur nilai", kind: "text", placeholder: "data.price", hint: "Pakai titik, misal items.0.price" },
      { key: "prefix", label: "Depan", kind: "text", placeholder: "$" },
      { key: "suffix", label: "Belakang", kind: "text", placeholder: " / hari" },
      { key: "every", label: "Ambil ulang tiap (detik)", kind: "number", min: 10, max: 86400 },
    ],
    Component: CustomWidget,
    Live: CustomLive,
    liveHint: "Nilainya ikut muter di notch kecil (prioritas paling rendah).",
  },
];

const BY_TYPE = new Map(WIDGETS.map((d) => [d.type, d]));
export const widgetDef = (type: string) => BY_TYPE.get(type);
