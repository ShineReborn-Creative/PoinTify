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
import { StatsWidget } from "./stats";
import { CalendarWidget, ClockWidget, CountdownLive, CountdownWidget, TIMEZONES } from "./time";
import { tr } from "../i18n";

export type Field =
  | { key: string; label: string; kind: "text"; placeholder?: string; hint?: string }
  | { key: string; label: string; kind: "textarea"; placeholder?: string; hint?: string }
  | { key: string; label: string; kind: "number"; min?: number; max?: number; hint?: string }
  | { key: string; label: string; kind: "datetime"; hint?: string }
  | { key: string; label: string; kind: "toggle"; hint?: string }
  | { key: string; label: string; kind: "select"; options: [string, string][]; hint?: string };

export type Group = "Waktu" | "Produktif" | "Media" | "Sistem" | "Info" | "Claude" | "Lainnya";
export const GROUPS: Group[] = ["Waktu", "Produktif", "Claude", "Media", "Sistem", "Info", "Lainnya"];

/** Nama grup buat ditampilin (ID grupnya tetap bahasa Indonesia). */
export function groupLabel(g: Group | "Semua"): string {
  const en: Record<Group | "Semua", string> = {
    Semua: "All",
    Waktu: "Time",
    Produktif: "Productivity",
    Media: "Media",
    Sistem: "System",
    Info: "Info",
    Claude: "Claude",
    Lainnya: "Other",
  };
  return tr(g, en[g]);
}

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
  /** Isi contoh buat preview di galeri (kalau beda dari defaultCfg). */
  previewCfg?: () => Record<string, unknown>;
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
  label: tr("Lokasi", "Location"),
  kind: "select",
  options: [
    ["auto", tr("Lokasi PC (otomatis)", "PC location (automatic)")],
    ["city", tr("Kota yang gue ketik", "A city I type")],
  ],
  hint: tr("Otomatis pakai layanan lokasi Windows. Kalau lokasinya mati, pakai kota di bawah.", "Uses Windows location services. If location is off, the city below is used."),
};
const CITY: Field = { key: "city", label: tr("Kota", "City"), kind: "text", placeholder: defaultCity(), hint: tr("Kosongin buat pakai kota dari zona waktu PC.", "Leave empty to use the city from your PC's time zone.") };

export const WIDGETS: WidgetDef[] = [
  // Waktu
  {
    type: "clock",
    name: tr("Jam", "Clock"),
    desc: tr("Jam sekarang, bisa tambah zona waktu kedua.", "The current time, with an optional second time zone."),
    icon: "clock",
    group: "Waktu",
    sizes: ["s", "w"],
    defaultSize: "s",
    fields: [
      { key: "tz2", label: tr("Zona kedua", "Second zone"), kind: "select", options: [["", tr("Nggak usah", "None")], ...TIMEZONES] },
      { key: "seconds", label: tr("Tampilin detik", "Show seconds"), kind: "toggle" },
    ],
    Component: ClockWidget,
  },
  {
    type: "calendar",
    name: tr("Kalender", "Calendar"),
    desc: tr("Tanggal hari ini atau sebulan penuh.", "Today's date or the whole month."),
    icon: "calendar",
    group: "Waktu",
    sizes: ["s", "l"],
    defaultSize: "l",
    Component: CalendarWidget,
  },
  {
    type: "countdown",
    name: tr("Hitung mundur", "Countdown"),
    desc: tr("Berapa lama lagi ke acara penting. Live pas tinggal sejam.", "Time left until something important. Goes Live in the final hour."),
    icon: "hourglass",
    group: "Waktu",
    sizes: ["s", "w"],
    defaultSize: "s",
    defaultCfg: { title: "Deadline" },
    previewCfg: () => ({ title: tr("Demo day", "Demo day"), target: new Date(Date.now() + 2 * 3600e3 + 14 * 60e3).toISOString() }),
    fields: [
      { key: "title", label: tr("Nama acara", "Event name"), kind: "text", placeholder: "Deadline" },
      { key: "target", label: tr("Waktunya", "When"), kind: "datetime" },
    ],
    Component: CountdownWidget,
    Live: CountdownLive,
    liveHint: tr("Nongol di notch pas tinggal 60 menit.", "Shows in the notch when 60 minutes are left."),
  },
  // Produktif
  {
    type: "todo",
    previewCfg: () => ({
      items: [
        { id: "1", text: tr("Rapihin README", "Tidy up the README"), done: true },
        { id: "2", text: tr("Rekam demo", "Record a demo"), done: false },
        { id: "3", text: tr("Rilis versi baru", "Ship the new version"), done: false },
      ],
    }),
    name: tr("To-do", "To-do"),
    desc: tr("Daftar kerjaan singkat, centang langsung dari notch.", "A short task list you can tick off right from the notch."),
    icon: "checklist",
    group: "Produktif",
    sizes: ["w", "l"],
    defaultSize: "l",
    fields: [{ key: "title", label: tr("Judul", "Title"), kind: "text", placeholder: tr("To-do", "To-do") }],
    Component: TodoWidget,
  },
  {
    type: "note",
    previewCfg: () => ({ text: tr("Beli kopi ☕\nTelpon mama", "Buy coffee ☕\nCall mom"), color: "yellow" }),
    name: tr("Catatan", "Note"),
    desc: tr("Sticky note buat coretan cepat.", "A sticky note for quick scribbles."),
    icon: "note",
    group: "Produktif",
    sizes: ["s", "w", "l"],
    defaultSize: "w",
    fields: [{ key: "color", label: tr("Warna", "Color"), kind: "select", options: NOTE_COLORS }],
    Component: NoteWidget,
  },
  {
    type: "stats",
    name: tr("Minggu ini", "This week"),
    desc: tr("Statistik 7 hari: fokus, minum, waktu app, lagu & app teratas.", "7-day stats: focus, water, app time, top songs & apps."),
    icon: "calendar",
    group: "Produktif",
    sizes: ["w", "l", "xl"],
    defaultSize: "l",
    single: true,
    Component: StatsWidget,
  },
  {
    type: "clipboard",
    name: tr("Riwayat clipboard", "Clipboard history"),
    desc: tr("Teks yang barusan lu copy, klik buat copy lagi.", "Text you copied recently. Click to copy it again."),
    icon: "clipboard",
    group: "Produktif",
    sizes: ["w", "l"],
    defaultSize: "l",
    Component: ClipboardWidget,
    single: true,
  },
  {
    type: "timer",
    name: tr("Timer fokus", "Focus timer"),
    desc: tr("Pomodoro yang sama kayak tab Timer.", "The same Pomodoro as the Focus tab."),
    icon: "timer",
    group: "Produktif",
    sizes: ["s", "w"],
    defaultSize: "s",
    Component: TimerWidget,
    single: true,
  },
  {
    type: "water",
    name: tr("Minum air", "Water"),
    desc: tr("Catat gelas air hari ini.", "Track today's glasses of water."),
    icon: "drop",
    group: "Produktif",
    sizes: ["s", "w"],
    defaultSize: "s",
    Component: WaterWidget,
    single: true,
  },
  {
    type: "launcher",
    previewCfg: () => ({
      items: [
        { id: "1", label: "GitHub", target: "https://github.com" },
        { id: "2", label: "YouTube", target: "https://youtube.com" },
        { id: "3", label: tr("Dokumen", "Documents"), target: "C:\\Users\\Public\\Documents" },
        { id: "4", label: "Figma", target: "https://figma.com" },
      ],
    }),
    name: tr("Peluncur", "Launcher"),
    desc: tr("Buka app, folder, atau link favorit sekali klik.", "Open favorite apps, folders, or links in one click."),
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
    name: tr("Usage Claude", "Claude usage"),
    desc: tr("Hitung mundur reset usage, plus notif pas udah reset.", "Counts down to your usage reset and tells you when it resets."),
    icon: "sparkle",
    group: "Claude",
    sizes: ["s", "w"],
    defaultSize: "w",
    defaultCfg: { cycleHours: 5 },
    previewCfg: () => ({ cycleHours: 5, resetAt: new Date(Date.now() + 3 * 3600e3 + 25 * 60e3).toISOString() }),
    fields: [
      { key: "resetAt", label: tr("Jam reset berikutnya", "Next reset time"), kind: "datetime", hint: tr("Liat di claude.ai › Settings › Usage.", "Find it at claude.ai › Settings › Usage.") },
      { key: "cycleHours", label: tr("Siklus (jam)", "Cycle (hours)"), kind: "number", min: 1, max: 168 },
    ],
    Component: UsageWidget,
    Live: UsageLive,
    liveHint: tr("Nongol di notch 10 menit sebelum reset.", "Shows in the notch 10 minutes before the reset."),
    single: true,
  },
  {
    type: "prompts",
    name: tr("Prompt cepat", "Quick prompts"),
    desc: tr("Tombol prompt siap pakai. {clipboard} diganti teks yang lagi dicopy.", "Ready-made prompt buttons. {clipboard} is replaced with the copied text."),
    icon: "sparkle",
    group: "Claude",
    sizes: ["w", "l"],
    defaultSize: "w",
    defaultCfg: { prompts: DEFAULT_PROMPTS },
    fields: [
      {
        key: "prompts",
        label: tr("Daftar prompt", "Prompts"),
        kind: "textarea",
        hint: tr("Satu baris satu prompt: Nama | isi prompt. Tulis \\n buat ganti baris.", "One prompt per line: Name | prompt text. Write \\n for a line break."),
      },
    ],
    Component: PromptsWidget,
  },
  {
    type: "sessions",
    name: tr("Sesi Claude", "Claude sessions"),
    desc: tr("Ringkasan sesi Claude yang lagi kerja.", "A summary of Claude sessions that are working."),
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
    name: tr("Musik", "Music"),
    desc: tr("Lagu yang lagi diputer, lengkap sama lirik.", "What's playing, with lyrics."),
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
    desc: tr("Pip nongkrong di Beranda. Bisa diseret keluar ke desktop.", "Pip hangs out on Home. Drag him out to the desktop."),
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
    name: tr("Sistem", "System"),
    desc: tr("CPU, RAM, disk, baterai. Live kalau ada yang kritis.", "CPU, RAM, disk, battery. Goes Live when something's critical."),
    icon: "cpu",
    group: "Sistem",
    sizes: ["s", "w"],
    defaultSize: "w",
    Component: SystemWidget,
    Live: SystemLive,
    liveHint: tr("Nongol di notch pas baterai lemah, CPU/RAM mentok, atau disk mau penuh.", "Shows in the notch when the battery is low, CPU/RAM maxes out, or the disk is nearly full."),
  },
  {
    type: "network",
    name: tr("Internet", "Network"),
    desc: tr("Kecepatan unduh dan unggah sekarang.", "Current download and upload speed."),
    icon: "wifi",
    group: "Sistem",
    sizes: ["s", "w"],
    defaultSize: "s",
    Component: NetworkWidget,
  },
  {
    type: "toggles",
    name: tr("Tombol cepat", "Quick toggles"),
    desc: tr("Volume, mic, dan mode tenang.", "Volume, mic, and quiet mode."),
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
    name: tr("Cuaca", "Weather"),
    desc: tr("Cuaca sekarang dan beberapa jam ke depan.", "The weather now and over the next few hours."),
    icon: "sun",
    group: "Info",
    sizes: ["s", "w", "l"],
    defaultSize: "s",
    fields: [LOC, CITY],
    Component: WeatherWidget,
  },
  {
    type: "prayer",
    name: tr("Jadwal sholat", "Prayer times"),
    desc: tr("Waktu sholat hari ini. Live pas mendekati waktunya.", "Today's prayer times. Goes Live as the next one approaches."),
    icon: "moon",
    group: "Info",
    sizes: ["s", "w"],
    defaultSize: "w",
    fields: [LOC, CITY],
    Component: PrayerWidget,
    Live: PrayerLive,
    liveHint: tr("Nongol di notch 15 menit sebelum waktu sholat.", "Shows in the notch 15 minutes before prayer time."),
  },
  {
    type: "currency",
    name: tr("Kurs", "Exchange rate"),
    desc: tr("Nilai tukar mata uang hari ini.", "Today's currency exchange rate."),
    icon: "money",
    group: "Info",
    sizes: ["s", "w"],
    defaultSize: "s",
    defaultCfg: { base: "USD", quote: "IDR" },
    fields: [
      { key: "base", label: tr("Dari", "From"), kind: "select", options: CURRENCIES.map((c) => [c, c]) },
      { key: "quote", label: tr("Ke", "To"), kind: "select", options: CURRENCIES.map((c) => [c, c]) },
    ],
    Component: CurrencyWidget,
  },
  {
    type: "github",
    name: "GitHub",
    desc: tr("Bintang, fork, issue, dan rilis terbaru repo lu.", "Stars, forks, issues, and the latest release of your repo."),
    icon: "star",
    group: "Info",
    sizes: ["s", "w"],
    defaultSize: "w",
    defaultCfg: { repo: "ShineReborn-Creative/PoinTify" },
    fields: [{ key: "repo", label: "Repo", kind: "text", placeholder: tr("pemilik/nama-repo", "owner/repo-name") }],
    Component: GithubWidget,
  },
  // Lainnya
  {
    type: "custom",
    name: tr("Kustom (JSON)", "Custom (JSON)"),
    desc: tr("Ambil satu angka atau teks dari API JSON mana aja.", "Pull a number or text from any JSON API."),
    icon: "plug",
    group: "Lainnya",
    sizes: ["s", "w"],
    defaultSize: "s",
    defaultCfg: { every: 60 },
    fields: [
      { key: "label", label: tr("Judul", "Title"), kind: "text", placeholder: tr("Harga Bitcoin", "Bitcoin price") },
      { key: "url", label: tr("Alamat API", "API URL"), kind: "text", placeholder: tr("https://api.contoh.com/data.json", "https://api.example.com/data.json") },
      { key: "path", label: tr("Jalur nilai", "Value path"), kind: "text", placeholder: "data.price", hint: tr("Pakai titik, misal items.0.price", "Use dots, e.g. items.0.price") },
      { key: "prefix", label: tr("Depan", "Prefix"), kind: "text", placeholder: "$" },
      { key: "suffix", label: tr("Belakang", "Suffix"), kind: "text", placeholder: tr(" / hari", " / day") },
      { key: "every", label: tr("Ambil ulang tiap (detik)", "Refresh every (seconds)"), kind: "number", min: 10, max: 86400 },
    ],
    Component: CustomWidget,
    Live: CustomLive,
    liveHint: tr("Nilainya ikut muter di notch kecil (prioritas paling rendah).", "The value rotates in the small notch (lowest priority)."),
  },
];

const BY_TYPE = new Map(WIDGETS.map((d) => [d.type, d]));
export const widgetDef = (type: string) => BY_TYPE.get(type);
