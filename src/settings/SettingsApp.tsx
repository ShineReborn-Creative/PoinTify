import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Pip } from "../components/Pip";
import { api, type ClaudeStatus, type HooksStatus, type Settings } from "../lib/api";
import { useStore } from "../lib/store";
import { settingsStore, updateSettings } from "../state/settings";

type Section = "umum" | "pip" | "musik" | "fokus" | "minum" | "claude" | "tentang";

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "umum", label: "Umum", icon: "gear" },
  { id: "pip", label: "Pip desktop", icon: "sparkle" },
  { id: "musik", label: "Musik & lirik", icon: "music" },
  { id: "fokus", label: "Timer fokus", icon: "timer" },
  { id: "minum", label: "Pengingat minum", icon: "drop" },
  { id: "claude", label: "Claude", icon: "chat" },
  { id: "tentang", label: "Tentang", icon: "info" },
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

export function SettingsApp() {
  const settings = useStore(settingsStore);
  const [section, setSection] = useState<Section>(() => takeRequestedSection() ?? "umum");

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
          <span data-tauri-drag-region>Pengaturan PoinTify</span>
        </div>
        <div className="titlebar-buttons">
          <button aria-label="Kecilkan" onClick={() => void getCurrentWindow().minimize()}>
            <Icon name="minus" size={14} />
          </button>
          <button aria-label="Tutup" className="close" onClick={() => void getCurrentWindow().close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="settings-body">
        <nav className="sidebar">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? "active" : ""} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={16} />
              {s.label}
            </button>
          ))}
        </nav>
        <main className="panel">
          {section === "umum" && <GeneralSection s={settings} />}
          {section === "pip" && <PipSection s={settings} />}
          {section === "musik" && <MusicSection s={settings} />}
          {section === "fokus" && <FocusSection s={settings} />}
          {section === "minum" && <WaterSection s={settings} />}
          {section === "claude" && <ClaudeSection s={settings} />}
          {section === "tentang" && <AboutSection />}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen kecil
// ---------------------------------------------------------------------------

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <span className="row-label">{label}</span>
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
      <button aria-label={`Kurangi ${label}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
        <Icon name="minus" size={12} />
      </button>
      <span className="tabular">
        {value}
        {suffix && <small> {suffix}</small>}
      </span>
      <button aria-label={`Tambah ${label}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
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
      {recording ? "Tekan kombinasi tombol…" : value || "Mati"}
    </button>
  );
}

function GeneralSection({ s }: { s: Settings }) {
  return (
    <>
      <Heading title="Umum" desc="Cara notch muncul dan nyambung sama Windows." />
      <div className="group">
        <Row label="Jalan otomatis pas Windows nyala" hint="PoinTify langsung nongol tiap lu nyalain PC.">
          <Toggle label="Jalan otomatis" checked={s.launchAtStartup} onChange={(v) => updateSettings({ launchAtStartup: v })} />
        </Row>
        <Row label="Buka pas kursor lewat" hint="Kalau dimatiin, notch baru kebuka pas diklik.">
          <Toggle label="Buka pas kursor lewat" checked={s.openOnHover} onChange={(v) => updateSettings({ openOnHover: v })} />
        </Row>
        <Row label="Jeda sebelum kebuka" hint="Biar notch nggak kebuka pas kursor cuma lewat sekilas.">
          <Stepper label="jeda" value={s.hoverDelayMs} min={0} max={1000} step={50} suffix="ms" onChange={(v) => updateSettings({ hoverDelayMs: v })} />
        </Row>
        <Row label="Sembunyi pas app fullscreen" hint="Nonton film atau main game tanpa diganggu.">
          <Toggle label="Sembunyi pas fullscreen" checked={s.hideInFullscreen} onChange={(v) => updateSettings({ hideInFullscreen: v })} />
        </Row>
        <Row label="Suara" hint="Bunyi kecil pas notch kebuka, timer selesai, atau Claude beres.">
          <Toggle label="Suara" checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
        </Row>
        <Row label="Shortcut buka chat" hint="Klik, lalu tekan kombinasi baru. Backspace buat matiin.">
          <ShortcutRecorder value={s.shortcut} onChange={(v) => updateSettings({ shortcut: v })} />
        </Row>
      </div>
    </>
  );
}

function PipSection({ s }: { s: Settings }) {
  const off = !s.petMode;
  return (
    <>
      <Heading title="Pip desktop" desc="Pip keluar dari notch dan hidup di layar lu: jalan-jalan, nangkring, ngomong, ikut kegiatan lu." />
      <div className="group">
        <Row label="Pip di desktop" hint="Bisa juga dengan nyeret Pip ke bawah dari notch. Lepas di area notch buat pulang.">
          <Toggle label="Pip di desktop" checked={s.petMode} onChange={(v) => updateSettings({ petMode: v })} />
        </Row>
      </div>
      <div className={`group${off ? " dim" : ""}`}>
        <Row label="Gerak sendiri" hint="Jalan, lari, loncat, sama manjat pinggir layar kalau lagi santai.">
          <Toggle label="Gerak sendiri" checked={s.petWander !== false} onChange={(v) => updateSettings({ petWander: v })} />
        </Row>
        <Row label="Seberapa aktif" hint="Kalem jarang gerak, Hiperaktif nggak bisa diem.">
          <select
            className="select"
            value={s.petActivity ?? "normal"}
            disabled={s.petWander === false}
            onChange={(e) => updateSettings({ petActivity: e.target.value as Settings["petActivity"] })}
          >
            <option value="calm">Kalem</option>
            <option value="normal">Normal</option>
            <option value="hyper">Hiperaktif</option>
          </select>
        </Row>
        <Row label="Ngomong tiap" hint="Balon omongan kecil: sapaan, ngingetin minum, komentar lagu. Mode tenang bikin dia diem.">
          <select
            className="select"
            value={String(s.petTalkMinutes ?? 3)}
            onChange={(e) => updateSettings({ petTalkMinutes: Number(e.target.value) })}
          >
            <option value="0">Nggak usah ngomong</option>
            <option value="1">1 menit</option>
            <option value="3">3 menit</option>
            <option value="5">5 menit</option>
            <option value="10">10 menit</option>
            <option value="30">30 menit</option>
          </select>
        </Row>
        <Row label="Nangkring di jendela" hint="Jatuh di atas jendela lain = duduk di pinggir atasnya. Jendelanya digeser, Pip ikut.">
          <Toggle label="Nangkring di jendela" checked={s.petPerch !== false} onChange={(v) => updateSettings({ petPerch: v })} />
        </Row>
        <Row label="Ikut kegiatan lu" hint="Ikat kepala pas fokus, laptop mini pas Claude kerja, joget pas musik.">
          <Toggle label="Ikut kegiatan" checked={s.petFollow !== false} onChange={(v) => updateSettings({ petFollow: v })} />
        </Row>
        <Row label="Papan info Live" hint="Pip megang papan info widget Live. Kalau penting, dia lari ke notch.">
          <Toggle label="Papan Live" checked={s.petLiveSign !== false} onChange={(v) => updateSettings({ petLiveSign: v })} />
        </Row>
        <Row label="Main sama kursor" hint="Kursor diem di deket Pip, dia nyamperin. Digoyang-goyang, dia nerkam. Dilempar ke arahnya, dia menghindar.">
          <Toggle label="Main sama kursor" checked={s.petCursor !== false} onChange={(v) => updateSettings({ petCursor: v })} />
        </Row>
        <Row label="Tidur siang" hint="Lama nggak diperhatiin, Pip tidur. Deketin kursor buat bangunin.">
          <Toggle label="Tidur siang" checked={s.petNap !== false} onChange={(v) => updateSettings({ petNap: v })} />
        </Row>
      </div>
      <p className="note">
        Cara main: seret dan lempar Pip, gosok kursor bolak-balik di atasnya buat ngelus, klik dua kali buat buka notch,
        klik kanan buat menu (minum, main bola, kejar-kejaran, tidur). Seret file ke Pip buat ngasih makan; filenya dicatet diem-diem ke Rak tanpa buka notch.
      </p>
    </>
  );
}

function MusicSection({ s }: { s: Settings }) {
  return (
    <>
      <Heading title="Musik & lirik" desc="Lagu dibaca dari kontrol media Windows: Spotify, browser, dan app musik lain." />
      <div className="group">
        <Row label="Tampilkan lirik" hint="Lirik sinkron diambil dari LRCLIB.">
          <Toggle label="Tampilkan lirik" checked={s.showLyrics} onChange={(v) => updateSettings({ showLyrics: v })} />
        </Row>
        <Row label="Lirik di notch kecil" hint="Baris yang lagi dinyanyiin jalan di tengah notch, tanpa perlu dibuka.">
          <Toggle
            label="Lirik di notch kecil"
            checked={s.compactLyrics !== false}
            disabled={!s.showLyrics}
            onChange={(v) => updateSettings({ compactLyrics: v })}
          />
        </Row>
        <Row label="Geser waktu lirik" hint="Tambah kalau lirik kerasa telat, kurangi kalau kecepetan.">
          <Stepper label="geser lirik" value={s.lyricOffsetMs} min={-3000} max={3000} step={100} suffix="ms" onChange={(v) => updateSettings({ lyricOffsetMs: v })} />
        </Row>
      </div>
    </>
  );
}

function FocusSection({ s }: { s: Settings }) {
  return (
    <>
      <Heading title="Timer fokus" desc="Teknik Pomodoro: fokus sebentar, istirahat sebentar, ulangi." />
      <div className="group">
        <Row label="Lama fokus">
          <Stepper label="lama fokus" value={s.focusMinutes} min={5} max={120} step={5} suffix="mnt" onChange={(v) => updateSettings({ focusMinutes: v })} />
        </Row>
        <Row label="Istirahat pendek">
          <Stepper label="istirahat pendek" value={s.shortBreakMinutes} min={1} max={30} suffix="mnt" onChange={(v) => updateSettings({ shortBreakMinutes: v })} />
        </Row>
        <Row label="Istirahat panjang">
          <Stepper label="istirahat panjang" value={s.longBreakMinutes} min={5} max={60} step={5} suffix="mnt" onChange={(v) => updateSettings({ longBreakMinutes: v })} />
        </Row>
        <Row label="Istirahat panjang tiap" hint="Jumlah sesi fokus sebelum istirahat panjang.">
          <Stepper label="sesi" value={s.sessionsBeforeLongBreak} min={2} max={8} suffix="sesi" onChange={(v) => updateSettings({ sessionsBeforeLongBreak: v })} />
        </Row>
        <Row label="Langsung mulai istirahat" hint="Abis fokus beres, timer istirahat jalan sendiri.">
          <Toggle label="Langsung mulai istirahat" checked={s.autoStartBreaks} onChange={(v) => updateSettings({ autoStartBreaks: v })} />
        </Row>
      </div>
    </>
  );
}

function WaterSection({ s }: { s: Settings }) {
  return (
    <>
      <Heading title="Pengingat minum" desc="Pip nyembul dari notch buat ngingetin lu minum air." />
      <div className="group">
        <Row label="Nyalakan pengingat">
          <Toggle label="Pengingat minum" checked={s.waterEnabled} onChange={(v) => updateSettings({ waterEnabled: v })} />
        </Row>
        <Row label="Ingetin tiap">
          <Stepper label="jarak pengingat" value={s.waterIntervalMinutes} min={15} max={180} step={15} suffix="mnt" onChange={(v) => updateSettings({ waterIntervalMinutes: v })} />
        </Row>
        <Row label="Target harian">
          <Stepper label="target" value={s.waterGoal} min={1} max={16} suffix="gelas" onChange={(v) => updateSettings({ waterGoal: v })} />
        </Row>
        <Row label="Mulai jam" hint="Di luar jam ini Pip nggak bakal ngingetin.">
          <Stepper label="jam mulai" value={s.waterStartHour} min={0} max={23} suffix=":00" onChange={(v) => updateSettings({ waterStartHour: v })} />
        </Row>
        <Row label="Sampai jam">
          <Stepper label="jam selesai" value={s.waterEndHour} min={1} max={24} suffix=":00" onChange={(v) => updateSettings({ waterEndHour: v })} />
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
    const picked = await openDialog({ directory: true, multiple: false, title: "Pilih folder project" });
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

  return (
    <>
      <Heading
        title="Claude"
        desc="Chat di PoinTify jalan lewat Claude Code di PC ini dan pakai login langganan Claude lu."
      />

      <div className={`status-card${status?.installed && status.loggedIn ? " ok" : ""}`}>
        <Pip mood={!status ? "thinking" : status.installed && status.loggedIn ? "happy" : "notify"} size={44} />
        <div className="status-text">
          <strong>
            {!status
              ? "Ngecek…"
              : !status.installed
                ? "Claude Code belum terpasang"
                : !status.loggedIn
                  ? "Claude Code belum login"
                  : "Siap dipakai"}
          </strong>
          <span className="muted">
            {status?.installed
              ? [status.version, status.account, status.path].filter(Boolean).join(" · ")
              : "Pasang lewat PowerShell: irm https://claude.ai/install.ps1 | iex"}
          </span>
        </div>
        <div className="status-actions">
          {status?.installed && !status.loggedIn && (
            <button className="btn btn-primary" onClick={() => void api.claudeLogin()}>
              Login
            </button>
          )}
          <button className="btn" onClick={() => void check()} disabled={checking}>
            <Icon name="refresh" size={14} /> {checking ? "Ngecek…" : "Cek lagi"}
          </button>
        </div>
      </div>

      <HooksCard />

      <div className="group">
        <Row label="Model bawaan" hint="Opus paling pinter, Sonnet seimbang, Haiku paling cepat.">
          <select className="select" value={s.claudeModel} onChange={(e) => updateSettings({ claudeModel: e.target.value })}>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
          </select>
        </Row>
        <Row label="Tingkat mikir" hint="Makin tinggi makin teliti, tapi lebih lama.">
          <select className="select" value={s.claudeEffort} onChange={(e) => updateSettings({ claudeEffort: e.target.value })}>
            <option value="low">Rendah</option>
            <option value="medium">Sedang</option>
            <option value="high">Tinggi</option>
            <option value="xhigh">Sangat tinggi</option>
            <option value="max">Maksimal</option>
          </select>
        </Row>
        <Row label="Mode bawaan" hint="Ngobrol: cuma baca dan diskusi. Kerjain: boleh ngedit file project.">
          <select className="select" value={s.claudeMode} onChange={(e) => updateSettings({ claudeMode: e.target.value })}>
            <option value="chat">Ngobrol</option>
            <option value="work">Kerjain</option>
          </select>
        </Row>
        <Row label="Lokasi claude.exe" hint="Kosongin biar dicari otomatis.">
          <input
            className="text-input"
            value={s.claudePath}
            placeholder="Otomatis"
            spellCheck={false}
            onChange={(e) => updateSettings({ claudePath: e.target.value })}
          />
        </Row>
      </div>

      <div className="group">
        <div className="group-head">
          <span>Folder project</span>
          <button className="btn" onClick={() => void addProject()}>
            <Icon name="plus" size={14} /> Tambah
          </button>
        </div>
        {s.projects.length === 0 ? (
          <p className="empty-note">
            Belum ada project. Tambahin folder project lu biar Claude bisa baca kodenya dan (di mode Kerjain) ngedit file.
          </p>
        ) : (
          s.projects.map((p) => (
            <div className="project-row" key={p.path}>
              <Icon name="folder" size={16} />
              <div className="project-text">
                <span>{p.name}</span>
                <span className="muted ellipsis">{p.path}</span>
              </div>
              <button className="icon-btn" aria-label={`Hapus ${p.name}`} title="Hapus dari daftar" onClick={() => removeProject(p.path)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

const HOOKS_TEXT: Record<HooksStatus["state"], { title: string; body: string }> = {
  installed: {
    title: "Sesi terminal dipantau",
    body: "Sesi Claude Code di terminal muncul di tab Sesi. Permintaan izin dan pertanyaannya bisa dijawab dari notch.",
  },
  outdated: {
    title: "Perlu dipasang ulang",
    body: "Hooks yang terpasang nunjuk ke lokasi PoinTify yang lama. Pasang ulang biar nyambung lagi.",
  },
  partial: {
    title: "Kepasang sebagian",
    body: "Ada hooks PoinTify yang hilang dari settings.json. Pasang ulang biar lengkap.",
  },
  missing: {
    title: "Pantau sesi Claude Code di terminal",
    body: "PoinTify nambahin hooks ke settings.json Claude Code. Hooks lain punya lu nggak diubah, dan file lama di-backup dulu. Kalau PoinTify lagi mati, Claude Code tetap jalan biasa.",
  },
};

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
  const text = HOOKS_TEXT[state];
  return (
    <div className={`status-card hooks-card${state === "installed" ? " ok" : ""}`}>
      <div className="hooks-main">
        <Icon name={state === "installed" ? "shield" : "terminal"} size={22} />
        <div className="status-text">
          <strong>{status ? text.title : "Ngecek…"}</strong>
          <span className="muted wrap">{text.body}</span>
        </div>
        <div className="status-actions">
          {state === "installed" ? (
            <button className="btn" disabled={busy} onClick={() => void run(api.hooksUninstall, "Hooks PoinTify udah dicopot.")}>
              Copot
            </button>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Tutup" : "Lihat isinya"}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !status || !!status.error}
                onClick={() => void run(api.hooksInstall, "Terpasang. Sesi Claude Code yang baru dibuka langsung kepantau.")}
              >
                {busy ? "Masang…" : state === "missing" ? "Pasang" : "Pasang ulang"}
              </button>
            </>
          )}
        </div>
      </div>
      {showPreview && status && (
        <div className="hooks-preview">
          <span className="muted">
            Ditambahin ke <code>{status.settingsPath}</code>:
          </span>
          <pre>{status.preview}</pre>
        </div>
      )}
      {(error || status?.error) && <p className="hooks-error">{error ?? status?.error}</p>}
      {note && <p className="hooks-note muted">{note}</p>}
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
      <Heading title="Tentang" desc="Asisten kecil di atas layar Windows lu." />
      <div className="about">
        <Pip mood={greeting ? "wave" : "idle"} size={96} glow interactive />
        <div>
          <h2>PoinTify {version && <span className="muted">v{version}</span>}</h2>
          <p className="muted">
            Notch ala Dynamic Island buat Windows: musik dan lirik, timer fokus, pengingat minum, rak file, dan chat
            sama Claude. Dibikin pakai Tauri, Rust, dan React.
          </p>
          <p className="muted">Maskotnya Pip: huruf P yang hidup. Titiknya itu "point", badge-nya "tify".</p>
          <div className="setup-actions">
            <button className="btn" onClick={() => void openUrl("https://lrclib.net")}>
              Lirik dari LRCLIB
            </button>
            <button className="btn" onClick={() => void openUrl("https://code.claude.com/docs")}>
              Dokumentasi Claude Code
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
