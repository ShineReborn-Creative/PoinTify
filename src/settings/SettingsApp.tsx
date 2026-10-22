import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Pip } from "../components/Pip";
import { api, type ClaudeStatus, type HooksStatus, type Settings } from "../lib/api";
import { emitTo } from "@tauri-apps/api/event";
import { tr } from "../i18n";
import { useStore } from "../lib/store";
import { settingsStore, updateSettings } from "../state/settings";
import { OFFSET_KEY } from "../state/island";
import { checkUpdate, installUpdate, updateStore } from "../state/update";

type Section = "umum" | "pip" | "musik" | "fokus" | "minum" | "claude" | "lanjutan" | "tentang";

const SECTIONS: { id: Section; label: () => string; icon: IconName }[] = [
  { id: "umum", label: () => tr("Umum", "General"), icon: "gear" },
  { id: "pip", label: () => tr("Pip desktop", "Desktop Pip"), icon: "sparkle" },
  { id: "musik", label: () => tr("Musik & lirik", "Music & lyrics"), icon: "music" },
  { id: "fokus", label: () => tr("Timer fokus", "Focus timer"), icon: "timer" },
  { id: "minum", label: () => tr("Pengingat minum", "Water reminder"), icon: "drop" },
  { id: "claude", label: () => "Claude", icon: "chat" },
  { id: "lanjutan", label: () => tr("Lanjutan", "Advanced"), icon: "wrench" },
  { id: "tentang", label: () => tr("Tentang", "About"), icon: "info" },
];

const SECTION_KEY = "pointify.settings.section";

/** Notch bisa minta pengaturan kebuka di bagian tertentu lewat localStorage. */
function takeRequestedSection(): Section | null {
  try {
    const v = localStorage.getItem(SECTION_KEY);
    if (v) localStorage.removeItem(SECTION_KEY);
    return SECTIONS.some((s) => s.id === v) ? (v as Section) : null;
  } catch {
    return null;
  }
}

/** Kata yang lagi dicari di kolom cari (kosong = nggak lagi nyari). */
const SearchCtx = createContext("");

/** Huruf kecil tanpa tanda baca, biar "wi-fi" ketemu pas ngetik "wifi". */
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, "");
function matches(text: string, q: string) {
  const hay = norm(text);
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function SettingsApp() {
  const settings = useStore(settingsStore);
  const [section, setSection] = useState<Section>(() => takeRequestedSection() ?? "umum");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;

  // Ctrl+F buat nyari, Esc buat ngosongin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Jendela udah kebuka: tetap pindah ke bagian yang diminta.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SECTION_KEY || !e.newValue) return;
      const next = takeRequestedSection();
      if (next) setSection(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!settings) return null;

  return (
    <div className="settings">
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-name" data-tauri-drag-region>
          <Pip size={18} />
          <span data-tauri-drag-region>{tr("Pengaturan PoinTify", "PoinTify Settings")}</span>
        </div>
        <div className="titlebar-buttons">
          <button aria-label={tr("Kecilkan", "Minimize")} onClick={() => void getCurrentWindow().minimize()}>
            <Icon name="minus" size={14} />
          </button>
          <button aria-label={tr("Tutup", "Close")} className="close" onClick={() => void getCurrentWindow().close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="settings-body">
        <nav className="sidebar">
          <label className="search-box">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              value={query}
              placeholder={tr("Cari pengaturan", "Search settings")}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            {searching && (
              <button className="search-clear" aria-label={tr("Hapus pencarian", "Clear search")} onClick={() => setQuery("")}>
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={!searching && section === s.id ? "active" : ""}
              onClick={() => {
                setQuery("");
                setSection(s.id);
              }}
            >
              <Icon name={s.icon} size={16} />
              {s.label()}
            </button>
          ))}
        </nav>
        <main className={`panel${searching ? " searching" : ""}`}>
          {searching ? (
            <div className="search-results">
              {SECTIONS.filter((s) => s.id !== "tentang").map((s) => (
                // Nama bagiannya cocok: tampilin semua isinya.
                <SearchCtx.Provider key={s.id} value={matches(s.label(), query) ? "" : query}>
                  <section className="search-section">
                    <SectionBody id={s.id} s={settings} />
                  </section>
                </SearchCtx.Provider>
              ))}
              <div className="search-empty">
                <Pip mood="thinking" size={56} />
                <span>{tr(`Nggak nemu "${query.trim()}".`, `Nothing found for "${query.trim()}".`)}</span>
              </div>
            </div>
          ) : (
            <SectionBody id={section} s={settings} />
          )}
        </main>
      </div>
    </div>
  );
}

function SectionBody({ id, s }: { id: Section; s: Settings }) {
  switch (id) {
    case "umum":
      return <GeneralSection s={s} />;
    case "pip":
      return <PipSection s={s} />;
    case "musik":
      return <MusicSection s={s} />;
    case "fokus":
      return <FocusSection s={s} />;
    case "minum":
      return <WaterSection s={s} />;
    case "claude":
      return <ClaudeSection s={s} />;
    case "lanjutan":
      return <AdvancedSection s={s} />;
    case "tentang":
      return <AboutSection />;
  }
}

// ---------------------------------------------------------------------------
// Komponen kecil
// ---------------------------------------------------------------------------

/** Tebelin bagian label yang cocok sama pencarian. */
function Highlight({ text }: { text: string }) {
  const q = useContext(SearchCtx).trim();
  if (!q) return <>{text}</>;
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const q = useContext(SearchCtx);
  if (q.trim() && !matches(`${label} ${hint ?? ""}`, q)) return null;
  return (
    <div className="row">
      <div className="row-text">
        <span className="row-label">
          <Highlight text={label} />
        </span>
        {hint && <span className="row-hint">{hint}</span>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  label: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="stepper" aria-label={label}>
      <button aria-label={`${tr("Kurangi", "Decrease")} ${label}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
        <Icon name="minus" size={12} />
      </button>
      <span className="tabular">
        {value}
        {suffix && <small> {suffix}</small>}
      </span>
      <button aria-label={`${tr("Tambah", "Increase")} ${label}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
        <Icon name="plus" size={12} />
      </button>
    </div>
  );
}

function Heading({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="panel-head">
      <h1>{title}</h1>
      <p>{desc}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian-bagian
// ---------------------------------------------------------------------------

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      className={`shortcut${recording ? " recording" : ""}`}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === "Escape") {
          setRecording(false);
          return;
        }
        if (e.key === "Backspace") {
          onChange("");
          setRecording(false);
          return;
        }
        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
        const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
        if (!mods.length) return;
        const key = e.code.startsWith("Key")
          ? e.code.slice(3)
          : e.code.startsWith("Digit")
            ? e.code.slice(5)
            : e.code === "Space"
              ? "Space"
              : e.key.length === 1
                ? e.key.toUpperCase()
                : e.key;
        onChange([...mods, key].join("+"));
        setRecording(false);
      }}
    >
      {recording ? tr("Tekan kombinasi tombol…", "Press a key combination…") : value || tr("Mati", "Off")}
    </button>
  );
}

function GeneralSection({ s }: { s: Settings }) {
  const replayTour = () => {
    updateSettings({ tourDone: false });
    void emitTo("main", "tour-start");
  };
  return (
    <>
      <Heading title={tr("Umum", "General")} desc={tr("Cara notch muncul dan nyambung sama Windows.", "How the notch shows up and works with Windows.")} />
      <div className="group">
        <Row label={tr("Bahasa", "Language")} hint={tr("Otomatis ikut bahasa Windows.", "Automatic follows your Windows language.")}>
          <select className="select" value={s.language ?? "auto"} onChange={(e) => updateSettings({ language: e.target.value as Settings["language"] })}>
            <option value="auto">{tr("Otomatis", "Automatic")}</option>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </Row>
        <Row label={tr("Jalan otomatis pas Windows nyala", "Start with Windows")} hint={tr("PoinTify langsung nongol tiap lu nyalain PC.", "PoinTify shows up every time you turn on your PC.")}>
          <Toggle label={tr("Jalan otomatis", "Start with Windows")} checked={s.launchAtStartup} onChange={(v) => updateSettings({ launchAtStartup: v })} />
        </Row>
        <Row label={tr("Buka pas kursor lewat", "Open on hover")} hint={tr("Kalau dimatiin, notch baru kebuka pas diklik.", "When off, the notch only opens when clicked.")}>
          <Toggle label={tr("Buka pas kursor lewat", "Open on hover")} checked={s.openOnHover} onChange={(v) => updateSettings({ openOnHover: v })} />
        </Row>
        <Row label={tr("Sembunyi pas app fullscreen", "Hide when an app is fullscreen")} hint={tr("Nonton film atau main game tanpa diganggu.", "Watch movies or play games undisturbed.")}>
          <Toggle label={tr("Sembunyi pas fullscreen", "Hide in fullscreen")} checked={s.hideInFullscreen} onChange={(v) => updateSettings({ hideInFullscreen: v })} />
        </Row>
        <Row label={tr("Suara", "Sounds")} hint={tr("Bunyi kecil pas notch kebuka, timer selesai, atau Claude beres.", "Small sounds when the notch opens, a timer ends, or Claude finishes.")}>
          <Toggle label={tr("Suara", "Sounds")} checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
        </Row>
        <Row label={tr("Shortcut buka chat", "Chat shortcut")} hint={tr("Klik, lalu tekan kombinasi baru. Backspace buat matiin.", "Click, then press a new combination. Backspace turns it off.")}>
          <ShortcutRecorder value={s.shortcut} onChange={(v) => updateSettings({ shortcut: v })} />
        </Row>
        <Row label={tr("Tour perkenalan", "Welcome tour")} hint={tr("Pip ngenalin fitur-fitur PoinTify satu-satu.", "Pip walks you through PoinTify's features.")}>
          <button className="btn" onClick={replayTour}>
            <Icon name="sparkle" size={14} /> {tr("Tonton lagi", "Replay")}
          </button>
        </Row>
      </div>
    </>
  );
}

function PipSection({ s }: { s: Settings }) {
  const off = !s.petMode;
  const min = (n: number) => tr(`${n} menit`, n === 1 ? "1 minute" : `${n} minutes`);
  return (
    <>
      <Heading
        title={tr("Pip desktop", "Desktop Pip")}
        desc={tr(
          "Pip keluar dari notch dan hidup di layar lu: jalan-jalan, nangkring, ngomong, ikut kegiatan lu.",
          "Pip leaves the notch and lives on your screen: wandering, perching, chatting, and joining in on what you do.",
        )}
      />
      <div className="group">
        <Row
          label={tr("Pip di desktop", "Pip on desktop")}
          hint={tr("Bisa juga dengan nyeret Pip ke bawah dari notch. Lepas di area notch buat pulang.", "You can also drag Pip down out of the notch. Drop him on the notch to send him home.")}
        >
          <Toggle label={tr("Pip di desktop", "Pip on desktop")} checked={s.petMode} onChange={(v) => updateSettings({ petMode: v })} />
        </Row>
      </div>
      <div className={`group${off ? " dim" : ""}`}>
        <Row label={tr("Gerak sendiri", "Move on his own")} hint={tr("Jalan, lari, loncat, sama manjat pinggir layar kalau lagi santai.", "Walks, runs, hops, and climbs screen edges when things are quiet.")}>
          <Toggle label={tr("Gerak sendiri", "Move on his own")} checked={s.petWander !== false} onChange={(v) => updateSettings({ petWander: v })} />
        </Row>
        <Row label={tr("Seberapa aktif", "Activity level")} hint={tr("Kalem jarang gerak, Hiperaktif nggak bisa diem.", "Calm rarely moves, Hyper can't sit still.")}>
          <select
            className="select"
            value={s.petActivity ?? "normal"}
            disabled={s.petWander === false}
            onChange={(e) => updateSettings({ petActivity: e.target.value as Settings["petActivity"] })}
          >
            <option value="calm">{tr("Kalem", "Calm")}</option>
            <option value="normal">Normal</option>
            <option value="hyper">{tr("Hiperaktif", "Hyper")}</option>
          </select>
        </Row>
        <Row
          label={tr("Ngomong tiap", "Talk every")}
          hint={tr("Balon omongan kecil: sapaan, ngingetin minum, komentar lagu. Mode tenang bikin dia diem.", "Little speech bubbles: greetings, water reminders, song comments. Quiet mode keeps him silent.")}
        >
          <select className="select" value={String(s.petTalkMinutes ?? 3)} onChange={(e) => updateSettings({ petTalkMinutes: Number(e.target.value) })}>
            <option value="0">{tr("Nggak usah ngomong", "Never")}</option>
            {[1, 3, 5, 10, 30].map((n) => (
              <option key={n} value={String(n)}>
                {min(n)}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label={tr("Nangkring di jendela", "Perch on windows")}
          hint={tr("Jatuh di atas jendela lain = duduk di pinggir atasnya. Jendelanya digeser, Pip ikut.", "Land on another window and he sits on its top edge. Move the window and Pip comes along.")}
        >
          <Toggle label={tr("Nangkring di jendela", "Perch on windows")} checked={s.petPerch !== false} onChange={(v) => updateSettings({ petPerch: v })} />
        </Row>
        <Row
          label={tr("Ikut kegiatan lu", "Join your activities")}
          hint={tr(
            "Ikat kepala pas fokus, laptop mini pas Claude kerja atau lu ngetik, joget pas musik, popcorn pas nonton.",
            "Headband while you focus, a mini laptop when Claude works or you type, dancing to music, popcorn when you watch.",
          )}
        >
          <Toggle label={tr("Ikut kegiatan", "Join activities")} checked={s.petFollow !== false} onChange={(v) => updateSettings({ petFollow: v })} />
        </Row>
        <Row label={tr("Papan info Live", "Live sign")} hint={tr("Pip megang papan info widget Live. Kalau penting, dia lari ke notch.", "Pip holds a sign with Live widget info. If it's urgent, he runs to the notch.")}>
          <Toggle label={tr("Papan Live", "Live sign")} checked={s.petLiveSign !== false} onChange={(v) => updateSettings({ petLiveSign: v })} />
        </Row>
        <Row
          label={tr("Main sama kursor", "Play with the cursor")}
          hint={tr(
            "Kursor diem di deket Pip, dia nyamperin. Digoyang-goyang, dia nerkam. Dilempar ke arahnya, dia menghindar.",
            "Rest the cursor near Pip and he comes over. Wiggle it and he pounces. Fling it at him and he dodges.",
          )}
        >
          <Toggle label={tr("Main sama kursor", "Play with the cursor")} checked={s.petCursor !== false} onChange={(v) => updateSettings({ petCursor: v })} />
        </Row>
        <Row label={tr("Tidur siang", "Naps")} hint={tr("Lama nggak diperhatiin, Pip tidur. Deketin kursor buat bangunin.", "Ignore Pip for a while and he dozes off. Move the cursor close to wake him.")}>
          <Toggle label={tr("Tidur siang", "Naps")} checked={s.petNap !== false} onChange={(v) => updateSettings({ petNap: v })} />
        </Row>
      </div>
      <p className="note">
        {tr(
          "Cara main: seret dan lempar Pip, gosok kursor bolak-balik di atasnya buat ngelus, klik dua kali buat buka notch, klik kanan buat menu (minum, main bola, kejar-kejaran, tidur). Seret file ke Pip buat ngasih makan; filenya dicatet diem-diem ke Rak tanpa buka notch.",
          "How to play: drag and throw Pip, rub the cursor back and forth over him to pet him, double-click to open the notch, right-click for the menu (drink, ball, chase, nap). Drag a file onto Pip to feed him; it quietly lands on the Shelf without opening the notch.",
        )}
      </p>
    </>
  );
}

function MusicSection({ s }: { s: Settings }) {
  return (
    <>
      <Heading
        title={tr("Musik & lirik", "Music & lyrics")}
        desc={tr("Lagu dibaca dari kontrol media Windows: Spotify, browser, dan app musik lain.", "Songs are read from Windows media controls: Spotify, browsers, and other music apps.")}
      />
      <div className="group">
        <Row label={tr("Tampilkan lirik", "Show lyrics")} hint={tr("Lirik sinkron diambil dari LRCLIB.", "Synced lyrics come from LRCLIB.")}>
          <Toggle label={tr("Tampilkan lirik", "Show lyrics")} checked={s.showLyrics} onChange={(v) => updateSettings({ showLyrics: v })} />
        </Row>
        <Row label={tr("Lirik di notch kecil", "Lyrics in the small notch")} hint={tr("Baris yang lagi dinyanyiin jalan di tengah notch, tanpa perlu dibuka.", "The line being sung scrolls in the middle of the notch, no need to open it.")}>
          <Toggle
            label={tr("Lirik di notch kecil", "Lyrics in the small notch")}
            checked={s.compactLyrics !== false}
            disabled={!s.showLyrics}
            onChange={(v) => updateSettings({ compactLyrics: v })}
          />
        </Row>
      </div>
    </>
  );
}

function FocusSection({ s }: { s: Settings }) {
  const mnt = tr("mnt", "min");
  return (
    <>
      <Heading title={tr("Timer fokus", "Focus timer")} desc={tr("Teknik Pomodoro: fokus sebentar, istirahat sebentar, ulangi.", "The Pomodoro technique: focus a bit, rest a bit, repeat.")} />
      <div className="group">
        <Row label={tr("Lama fokus", "Focus length")}>
          <Stepper label={tr("lama fokus", "focus length")} value={s.focusMinutes} min={5} max={120} step={5} suffix={mnt} onChange={(v) => updateSettings({ focusMinutes: v })} />
        </Row>
        <Row label={tr("Istirahat pendek", "Short break")}>
          <Stepper label={tr("istirahat pendek", "short break")} value={s.shortBreakMinutes} min={1} max={30} suffix={mnt} onChange={(v) => updateSettings({ shortBreakMinutes: v })} />
        </Row>
        <Row label={tr("Istirahat panjang", "Long break")}>
          <Stepper label={tr("istirahat panjang", "long break")} value={s.longBreakMinutes} min={5} max={60} step={5} suffix={mnt} onChange={(v) => updateSettings({ longBreakMinutes: v })} />
        </Row>
        <Row label={tr("Istirahat panjang tiap", "Long break every")} hint={tr("Jumlah sesi fokus sebelum istirahat panjang.", "Number of focus sessions before a long break.")}>
          <Stepper
            label={tr("sesi", "sessions")}
            value={s.sessionsBeforeLongBreak}
            min={2}
            max={8}
            suffix={tr("sesi", "sessions")}
            onChange={(v) => updateSettings({ sessionsBeforeLongBreak: v })}
          />
        </Row>
        <Row label={tr("Langsung mulai istirahat", "Start breaks automatically")} hint={tr("Abis fokus beres, timer istirahat jalan sendiri.", "When a focus session ends, the break timer starts by itself.")}>
          <Toggle label={tr("Langsung mulai istirahat", "Start breaks automatically")} checked={s.autoStartBreaks} onChange={(v) => updateSettings({ autoStartBreaks: v })} />
        </Row>
      </div>
    </>
  );
}

function WaterSection({ s }: { s: Settings }) {
  return (
    <>
      <Heading title={tr("Pengingat minum", "Water reminder")} desc={tr("Pip nyembul dari notch buat ngingetin lu minum air.", "Pip pops out of the notch to remind you to drink water.")} />
      <div className="group">
        <Row label={tr("Nyalakan pengingat", "Enable reminder")}>
          <Toggle label={tr("Pengingat minum", "Water reminder")} checked={s.waterEnabled} onChange={(v) => updateSettings({ waterEnabled: v })} />
        </Row>
        <Row label={tr("Ingetin tiap", "Remind every")}>
          <Stepper
            label={tr("jarak pengingat", "reminder interval")}
            value={s.waterIntervalMinutes}
            min={15}
            max={180}
            step={15}
            suffix={tr("mnt", "min")}
            onChange={(v) => updateSettings({ waterIntervalMinutes: v })}
          />
        </Row>
        <Row label={tr("Target harian", "Daily goal")}>
          <Stepper label={tr("target", "goal")} value={s.waterGoal} min={1} max={16} suffix={tr("gelas", "glasses")} onChange={(v) => updateSettings({ waterGoal: v })} />
        </Row>
        <Row label={tr("Mulai jam", "From")} hint={tr("Di luar jam ini Pip nggak bakal ngingetin.", "Pip won't remind you outside these hours.")}>
          <Stepper label={tr("jam mulai", "start hour")} value={s.waterStartHour} min={0} max={23} suffix=":00" onChange={(v) => updateSettings({ waterStartHour: v })} />
        </Row>
        <Row label={tr("Sampai jam", "Until")}>
          <Stepper label={tr("jam selesai", "end hour")} value={s.waterEndHour} min={1} max={24} suffix=":00" onChange={(v) => updateSettings({ waterEndHour: v })} />
        </Row>
      </div>
    </>
  );
}

function ClaudeSection({ s }: { s: Settings }) {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setStatus(await api.claudeStatus());
    } finally {
      setChecking(false);
    }
  };

  // Tunggu ketikan selesai dan tersimpan sebelum ngecek ulang.
  useEffect(() => {
    const id = window.setTimeout(() => void check(), 700);
    return () => window.clearTimeout(id);
  }, [s.claudePath]);

  const addProject = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: tr("Pilih folder project", "Choose a project folder") });
    if (typeof picked !== "string" || s.projects.some((p) => p.path === picked)) return;
    const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? picked;
    updateSettings({ projects: [...s.projects, { name, path: picked }] });
  };

  const removeProject = (path: string) => {
    updateSettings({
      projects: s.projects.filter((p) => p.path !== path),
      activeProject: s.activeProject === path ? null : s.activeProject,
    });
  };

  const checkingText = tr("Ngecek…", "Checking…");
  return (
    <>
      <Heading
        title="Claude"
        desc={tr(
          "Chat di PoinTify jalan lewat Claude Code di PC ini dan pakai login langganan Claude lu. Fitur lain PoinTify jalan tanpa Claude.",
          "Chat in PoinTify runs through Claude Code on this PC using your Claude subscription. Everything else in PoinTify works without Claude.",
        )}
      />

      <div className={`status-card${status?.installed && status.loggedIn ? " ok" : ""}`}>
        <Pip mood={!status ? "thinking" : status.installed && status.loggedIn ? "happy" : "notify"} size={44} />
        <div className="status-text">
          <strong>
            {!status
              ? checkingText
              : !status.installed
                ? tr("Claude Code belum terpasang", "Claude Code isn't installed")
                : !status.loggedIn
                  ? tr("Claude Code belum login", "Claude Code isn't logged in")
                  : tr("Siap dipakai", "Ready")}
          </strong>
          <span className="muted">
            {status?.installed
              ? [status.version, status.account, status.path].filter(Boolean).join(" · ")
              : tr("Pasang lewat PowerShell: irm https://claude.ai/install.ps1 | iex", "Install from PowerShell: irm https://claude.ai/install.ps1 | iex")}
          </span>
        </div>
        <div className="status-actions">
          {status?.installed && !status.loggedIn && (
            <button className="btn btn-primary" onClick={() => void api.claudeLogin()}>
              Login
            </button>
          )}
          <button className="btn" onClick={() => void check()} disabled={checking}>
            <Icon name="refresh" size={14} /> {checking ? checkingText : tr("Cek lagi", "Check again")}
          </button>
        </div>
      </div>

      <HooksCard />

      <div className="group">
        <Row label={tr("Model bawaan", "Default model")} hint={tr("Opus paling pinter, Sonnet seimbang, Haiku paling cepat.", "Opus is the smartest, Sonnet is balanced, Haiku is the fastest.")}>
          <select className="select" value={s.claudeModel} onChange={(e) => updateSettings({ claudeModel: e.target.value })}>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>
        </Row>
        <Row label={tr("Tingkat mikir", "Effort")} hint={tr("Makin tinggi makin teliti, tapi lebih lama.", "Higher is more thorough, but slower.")}>
          <select className="select" value={s.claudeEffort} onChange={(e) => updateSettings({ claudeEffort: e.target.value })}>
            <option value="low">{tr("Rendah", "Low")}</option>
            <option value="medium">{tr("Sedang", "Medium")}</option>
            <option value="high">{tr("Tinggi", "High")}</option>
            <option value="xhigh">{tr("Sangat tinggi", "Very high")}</option>
            <option value="max">{tr("Maksimal", "Max")}</option>
          </select>
        </Row>
        <Row label={tr("Mode bawaan", "Default mode")} hint={tr("Ngobrol: cuma baca dan diskusi. Kerjain: boleh ngedit file project.", "Chat: read and discuss only. Work: may edit project files.")}>
          <select className="select" value={s.claudeMode} onChange={(e) => updateSettings({ claudeMode: e.target.value })}>
            <option value="chat">{tr("Ngobrol", "Chat")}</option>
            <option value="work">{tr("Kerjain", "Work")}</option>
          </select>
        </Row>
      </div>

      <div className="group">
        <div className="group-head">
          <span>{tr("Folder project", "Project folders")}</span>
          <button className="btn" onClick={() => void addProject()}>
            <Icon name="plus" size={14} /> {tr("Tambah", "Add")}
          </button>
        </div>
        {s.projects.length === 0 ? (
          <p className="empty-note">
            {tr(
              "Belum ada project. Tambahin folder project lu biar Claude bisa baca kodenya dan (di mode Kerjain) ngedit file.",
              "No projects yet. Add your project folder so Claude can read the code and (in Work mode) edit files.",
            )}
          </p>
        ) : (
          s.projects.map((p) => (
            <div className="project-row" key={p.path}>
              <Icon name="folder" size={16} />
              <div className="project-text">
                <span>{p.name}</span>
                <span className="muted ellipsis">{p.path}</span>
              </div>
              <button className="icon-btn" aria-label={`${tr("Hapus", "Remove")} ${p.name}`} title={tr("Hapus dari daftar", "Remove from list")} onClick={() => removeProject(p.path)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function AdvancedSection({ s }: { s: Settings }) {
  const [centered, setCentered] = useState(false);
  return (
    <>
      <Heading
        title={tr("Lanjutan", "Advanced")}
        desc={tr("Setelan yang jarang perlu diubah. Biarin aja kalau semuanya udah enak.", "Settings you rarely need to touch. Leave them be if everything feels right.")}
      />
      <div className="group">
        <Row label={tr("Jeda sebelum kebuka", "Hover delay")} hint={tr("Biar notch nggak kebuka pas kursor cuma lewat sekilas.", "So the notch doesn't open when the cursor just passes by.")}>
          <Stepper label={tr("jeda", "delay")} value={s.hoverDelayMs} min={0} max={1000} step={50} suffix="ms" onChange={(v) => updateSettings({ hoverDelayMs: v })} />
        </Row>
        <Row label={tr("Balikin notch ke tengah", "Center the notch")} hint={tr("Kalau notch-nya pernah lu geser ke kiri atau kanan.", "If you've dragged the notch to the left or right.")}>
          <button
            className="btn"
            onClick={() => {
              // Lewat localStorage (semua jendela PoinTify berbagi), plus event buat jaga-jaga.
              try {
                localStorage.setItem(OFFSET_KEY, "0");
              } catch {
                // Nggak apa-apa, event di bawah tetap jalan.
              }
              void emitTo("main", "island-reset-offset");
              setCentered(true);
              window.setTimeout(() => setCentered(false), 1600);
            }}
          >
            <Icon name={centered ? "check" : "reset"} size={14} /> {centered ? tr("Udah", "Done") : tr("Tengahin", "Center")}
          </button>
        </Row>
        <Row label={tr("Geser waktu lirik", "Lyrics offset")} hint={tr("Tambah kalau lirik kerasa telat, kurangi kalau kecepetan.", "Increase if lyrics feel late, decrease if they're early.")}>
          <Stepper label={tr("geser lirik", "lyrics offset")} value={s.lyricOffsetMs} min={-3000} max={3000} step={100} suffix="ms" onChange={(v) => updateSettings({ lyricOffsetMs: v })} />
        </Row>
        <Row label={tr("Update otomatis", "Automatic updates")} hint={tr("Cek versi baru di GitHub tiap PoinTify nyala. Masangnya tetap nunggu izin lu.", "Checks GitHub for a new version on startup. Installing still asks you first.")}>
          <Toggle label={tr("Update otomatis", "Automatic updates")} checked={s.autoUpdate !== false} onChange={(v) => updateSettings({ autoUpdate: v })} />
        </Row>
        <Row label={tr("Lokasi claude.exe", "claude.exe location")} hint={tr("Kosongin biar dicari otomatis.", "Leave empty to find it automatically.")}>
          <input
            className="text-input"
            value={s.claudePath}
            placeholder={tr("Otomatis", "Automatic")}
            spellCheck={false}
            onChange={(e) => updateSettings({ claudePath: e.target.value })}
          />
        </Row>
      </div>
    </>
  );
}

const HOOKS_TEXT = (): Record<HooksStatus["state"], { title: string; body: string }> => ({
  installed: {
    title: tr("Sesi terminal dipantau", "Terminal sessions are monitored"),
    body: tr(
      "Sesi Claude Code di terminal muncul di tab Sesi. Permintaan izin dan pertanyaannya bisa dijawab dari notch.",
      "Claude Code sessions in your terminal show up in the Sessions tab. You can answer permission requests and questions from the notch.",
    ),
  },
  outdated: {
    title: tr("Perlu dipasang ulang", "Needs reinstalling"),
    body: tr(
      "Hooks yang terpasang nunjuk ke lokasi PoinTify yang lama. Pasang ulang biar nyambung lagi.",
      "The installed hooks point to an old PoinTify location. Reinstall to reconnect.",
    ),
  },
  partial: {
    title: tr("Kepasang sebagian", "Partially installed"),
    body: tr("Ada hooks PoinTify yang hilang dari settings.json. Pasang ulang biar lengkap.", "Some PoinTify hooks are missing from settings.json. Reinstall to complete them."),
  },
  missing: {
    title: tr("Pantau sesi Claude Code di terminal", "Monitor Claude Code sessions in the terminal"),
    body: tr(
      "PoinTify nambahin hooks ke settings.json Claude Code. Hooks lain punya lu nggak diubah, dan file lama di-backup dulu. Kalau PoinTify lagi mati, Claude Code tetap jalan biasa.",
      "PoinTify adds hooks to Claude Code's settings.json. Your other hooks stay untouched and the old file is backed up first. If PoinTify isn't running, Claude Code works as usual.",
    ),
  },
});

function HooksCard() {
  const [status, setStatus] = useState<HooksStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    void api.hooksStatus().then(setStatus);
  }, []);

  const run = async (fn: () => ReturnType<typeof api.hooksInstall>, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      setStatus(r.status);
      setNote(r.backupPath ? `${done} Backup: ${r.backupPath}` : done);
      setShowPreview(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? "missing";
  const text = HOOKS_TEXT()[state];
  return (
    <div className={`status-card hooks-card${state === "installed" ? " ok" : ""}`}>
      <div className="hooks-main">
        <Icon name={state === "installed" ? "shield" : "terminal"} size={22} />
        <div className="status-text">
          <strong>{status ? text.title : tr("Ngecek…", "Checking…")}</strong>
          <span className="muted wrap">{text.body}</span>
        </div>
        <div className="status-actions">
          {state === "installed" ? (
            <button className="btn" disabled={busy} onClick={() => void run(api.hooksUninstall, tr("Hooks PoinTify udah dicopot.", "PoinTify hooks removed."))}>
              {tr("Copot", "Remove")}
            </button>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? tr("Tutup", "Close") : tr("Lihat isinya", "Preview")}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !status || !!status.error}
                onClick={() => void run(api.hooksInstall, tr("Terpasang. Sesi Claude Code yang baru dibuka langsung kepantau.", "Installed. New Claude Code sessions are monitored right away."))}
              >
                {busy ? tr("Masang…", "Installing…") : state === "missing" ? tr("Pasang", "Install") : tr("Pasang ulang", "Reinstall")}
              </button>
            </>
          )}
        </div>
      </div>
      {showPreview && status && (
        <div className="hooks-preview">
          <span className="muted">
            {tr("Ditambahin ke", "Added to")} <code>{status.settingsPath}</code>:
          </span>
          <pre>{status.preview}</pre>
        </div>
      )}
      {(error || status?.error) && <p className="hooks-error">{error ?? status?.error}</p>}
      {note && <p className="hooks-note muted">{note}</p>}
    </div>
  );
}

function UpdateCard() {
  const u = useStore(updateStore);
  const busy = u.status === "checking" || u.status === "downloading";
  const title =
    u.status === "checking"
      ? tr("Ngecek versi baru…", "Checking for updates…")
      : u.status === "available"
        ? tr(`Versi ${u.version} udah ada`, `Version ${u.version} is available`)
        : u.status === "downloading"
          ? tr(`Ngunduh… ${u.progress ?? 0}%`, `Downloading… ${u.progress ?? 0}%`)
          : u.status === "ready"
            ? tr("Beres, PoinTify restart…", "Done, restarting PoinTify…")
            : u.status === "none"
              ? tr("Udah versi terbaru", "You're on the latest version")
              : u.status === "off"
                ? tr("Update otomatis belum aktif", "Auto-update isn't active")
              : u.status === "error"
                ? tr("Gagal ngecek update", "Couldn't check for updates")
                : tr("Update", "Updates");
  return (
    <div className={`status-card update-card${u.status === "none" ? " ok" : ""}`}>
      <Icon name="refresh" size={22} />
      <div className="status-text">
        <strong>{title}</strong>
        <span className="muted wrap">
          {u.status === "error" || u.status === "off"
            ? u.error
            : u.status === "available" && u.notes
              ? u.notes.split("\n").find((l) => l.trim()) ?? ""
              : tr("Update diambil dari GitHub Releases PoinTify.", "Updates come from PoinTify's GitHub Releases.")}
        </span>
      </div>
      <div className="status-actions">
        {u.status === "available" ? (
          <button className="btn btn-primary" onClick={() => void installUpdate()}>
            {tr("Pasang & restart", "Install & restart")}
          </button>
        ) : (
          <button className="btn" disabled={busy || u.status === "ready"} onClick={() => void checkUpdate()}>
            <Icon name="refresh" size={14} /> {u.status === "checking" ? tr("Ngecek…", "Checking…") : tr("Cek update", "Check for updates")}
          </button>
        )}
      </div>
    </div>
  );
}

function AboutSection() {
  const [version, setVersion] = useState("");
  const [greeting, setGreeting] = useState(true);
  useEffect(() => {
    void getVersion().then(setVersion);
    const id = window.setTimeout(() => setGreeting(false), 2400);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <>
      <Heading title={tr("Tentang", "About")} desc={tr("Asisten kecil di atas layar Windows lu.", "A little helper at the top of your Windows screen.")} />
      <div className="about">
        <Pip mood={greeting ? "wave" : "idle"} size={96} glow interactive />
        <div>
          <h2>PoinTify {version && <span className="muted">v{version}</span>}</h2>
          <p className="muted">
            {tr(
              "Notch ala Dynamic Island buat Windows: musik dan lirik, widget, timer fokus, pengingat minum, rak file, Pip yang hidup di desktop, dan chat sama Claude. Dibikin pakai Tauri, Rust, dan React.",
              "A Dynamic Island-style notch for Windows: music and lyrics, widgets, a focus timer, water reminders, a file shelf, a Pip who lives on your desktop, and chat with Claude. Built with Tauri, Rust, and React.",
            )}
          </p>
          <p className="muted">{tr('Maskotnya Pip: huruf P yang hidup. Titiknya itu "point", badge-nya "tify".', 'The mascot is Pip, a living letter P. The dot is the "point", the badge is the "tify".')}</p>
          <div className="setup-actions">
            <button className="btn" onClick={() => void openUrl("https://github.com/ShineReborn-Creative/PoinTify")}>
              GitHub
            </button>
            <button className="btn" onClick={() => void openUrl("https://lrclib.net")}>
              {tr("Lirik dari LRCLIB", "Lyrics by LRCLIB")}
            </button>
            <button className="btn" onClick={() => void openUrl("https://code.claude.com/docs")}>
              {tr("Dokumentasi Claude Code", "Claude Code docs")}
            </button>
          </div>
        </div>
      </div>
      <UpdateCard />
    </>
  );
}
