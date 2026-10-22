import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { api } from "../lib/api";
import { calc } from "../lib/calc";
import { useStore } from "../lib/store";
import { claudeStatusStore, sendMessage } from "../state/chat";
import { collapse, expand, paletteHeightStore } from "../state/island";
import { quietStore, setQuiet } from "../state/quiet";
import { settingsStore, updateSettings } from "../state/settings";
import { pauseTimer, startTimer, timerStore } from "../state/timer";
import { drink } from "../state/water";
import { CURRENCIES } from "../widgets/info";
import { isEn, locale, tr } from "../i18n";

type Entry = { name: string; path: string };
type Item = {
  id: string;
  group: string;
  title: string;
  sub?: string;
  icon: ReactNode;
  /** Jalanin. Balikin true kalau palette jangan ditutup. */
  run: () => unknown;
};

/** Skor kecocokan nama: awalan > awal kata > ada di tengah > huruf berurutan. */
function score(name: string, q: string): number {
  const n = name.toLowerCase();
  const s = q.toLowerCase().trim();
  if (!s) return 0;
  if (n.startsWith(s)) return 100 - n.length / 100;
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(s))) return 80;
  if (n.includes(s)) return 60;
  let i = 0;
  for (const ch of n) if (ch === s[i]) i++;
  return i === s.length ? 30 : -1;
}

const ICON_CACHE = new Map<string, string | null>();

function AppIcon({ path, fallback }: { path: string; fallback: IconName }) {
  const [src, setSrc] = useState<string | null | undefined>(ICON_CACHE.get(path));
  useEffect(() => {
    if (ICON_CACHE.has(path)) return setSrc(ICON_CACHE.get(path));
    let alive = true;
    void api
      .launchIcon(path)
      .catch(() => null)
      .then((v) => {
        ICON_CACHE.set(path, v);
        if (alive) setSrc(v);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return src ? <img className="pal-img" src={src} alt="" /> : <Icon name={fallback} size={16} />;
}

/** "10 usd", "10 usd idr", "10 usd ke idr", "10 usd to eur". */
function parseCurrency(q: string): { amount: number; from: string; to: string } | null {
  const m = q.trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-z]{3})(?:\s*(?:to|ke|in|=|->)?\s*([a-z]{3}))?$/i);
  if (!m) return null;
  const from = m[2].toUpperCase();
  const to = (m[3] ?? (from === "IDR" ? "USD" : isEn() ? "USD" : "IDR")).toUpperCase();
  if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) return null;
  return { amount: Number(m[1].replace(",", ".")), from, to };
}

const fmt = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: Math.abs(v) < 10 ? 6 : 2 });

/**
 * Command palette di notch (shortcut bawaan Alt+Space): buka app, file yang
 * baru dibuka, hitung-hitungan, konversi kurs, perintah PoinTify, tanya Claude.
 */
export function Palette() {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [apps, setApps] = useState<Entry[]>([]);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [fx, setFx] = useState<{ key: string; value: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const claude = useStore(claudeStatusStore);
  const settings = useStore(settingsStore);
  const timer = useStore(timerStore);
  const quiet = useStore(quietStore);

  useEffect(() => {
    input.current?.focus();
    void api.paletteApps().then(setApps).catch(() => setApps([]));
    void api.paletteRecent().then(setRecent).catch(() => setRecent([]));
  }, []);
  useEffect(() => setSel(0), [q]);

  // Kurs: ambil pas ngetik berhenti sebentar.
  const cur = parseCurrency(q);
  const curKey = cur ? `${cur.from}-${cur.to}` : "";
  useEffect(() => {
    if (!cur) return;
    const id = window.setTimeout(() => {
      void api
        .httpGetJson<{ rates: Record<string, number> }>(`https://api.frankfurter.dev/v1/latest?base=${cur.from}&symbols=${cur.to}`)
        .then((r) => setFx({ key: curKey, value: r.rates[cur.to] }))
        .catch(() => setFx(null));
    }, 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const query = q.trim();
    const G = {
      calc: tr("Hitung", "Calculator"),
      fx: tr("Kurs", "Currency"),
      apps: tr("App", "Apps"),
      files: tr("File terbaru", "Recent files"),
      cmd: tr("Perintah", "Commands"),
      more: tr("Lainnya", "More"),
    };

    const value = calc(query);
    if (value !== null) {
      out.push({
        id: "calc",
        group: G.calc,
        title: `= ${fmt(value)}`,
        sub: tr("Enter buat salin", "Enter to copy"),
        icon: <Icon name="grid" size={16} />,
        run: async () => {
          await navigator.clipboard.writeText(String(value));
          setCopied(true);
          window.setTimeout(collapse, 650);
          return true;
        },
      });
    }

    if (cur) {
      const rate = fx?.key === curKey ? fx.value : null;
      const result = rate ? cur.amount * rate : null;
      out.push({
        id: "fx",
        group: G.fx,
        title: result != null ? `${fmt(cur.amount)} ${cur.from} = ${fmt(result)} ${cur.to}` : tr("Ngambil kurs…", "Fetching rates…"),
        sub: result != null ? tr("Enter buat salin · Frankfurter", "Enter to copy · Frankfurter") : undefined,
        icon: <Icon name="money" size={16} />,
        run: async () => {
          if (result == null) return true;
          await navigator.clipboard.writeText(String(Math.round(result * 100) / 100));
          setCopied(true);
          window.setTimeout(collapse, 650);
          return true;
        },
      });
    }

    const commands: { k: string; title: string; icon: IconName; run: () => unknown }[] = [
      timer.running
        ? { k: "jeda timer pause stop fokus focus", title: tr("Jeda timer fokus", "Pause focus timer"), icon: "pause", run: pauseTimer }
        : { k: "mulai timer fokus start focus pomodoro", title: tr("Mulai timer fokus", "Start focus timer"), icon: "timer", run: startTimer },
      { k: "minum catat air water drink", title: tr("Catat minum satu gelas", "Log a glass of water"), icon: "drop", run: drink },
      { k: "chat claude ngobrol", title: tr("Buka chat Claude", "Open Claude chat"), icon: "chat", run: () => expand("chat") },
      { k: "rak shelf file", title: tr("Buka Rak", "Open Shelf"), icon: "shelf", run: () => expand("shelf") },
      { k: "beranda home widget", title: tr("Buka Beranda", "Open Home"), icon: "home", run: () => expand("home") },
      {
        k: "pip desktop pet keluar pulang",
        title: settings?.petMode ? tr("Pip pulang ke notch", "Bring Pip back to the notch") : tr("Keluarin Pip ke desktop", "Let Pip out on the desktop"),
        icon: "sparkle",
        run: () => updateSettings({ petMode: !settings?.petMode }),
      },
      {
        k: "tenang quiet mute notif",
        title: quiet ? tr("Matiin mode tenang", "Turn off quiet mode") : tr("Nyalain mode tenang", "Turn on quiet mode"),
        icon: quiet ? "bell" : "bellOff",
        run: () => setQuiet(!quiet),
      },
      { k: "pengaturan settings setelan", title: tr("Buka pengaturan", "Open settings"), icon: "gear", run: () => void api.settingsOpen() },
    ];

    if (!query) {
      commands.forEach((c, i) => out.push({ id: `cmd${i}`, group: G.cmd, title: c.title, icon: <Icon name={c.icon} size={16} />, run: c.run }));
      recent.slice(0, 6).forEach((f) =>
        out.push({ id: `f:${f.path}`, group: G.files, title: f.name, icon: <AppIcon path={f.path} fallback="file" />, run: () => void api.launchOpen(f.path) }),
      );
      return out;
    }

    // `min` 60 = harus beneran ada kata yang cocok (bukan cuma huruf berurutan).
    const ranked = <T,>(xs: T[], name: (x: T) => string, n: number, min = 1) =>
      xs
        .map((x) => [x, score(name(x), query)] as const)
        .filter(([, s]) => s >= min)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([x]) => x);

    ranked(apps, (a) => a.name, 6).forEach((a) =>
      out.push({ id: `a:${a.path}`, group: G.apps, title: a.name, icon: <AppIcon path={a.path} fallback="rocket" />, run: () => void api.launchOpen(a.path) }),
    );
    ranked(commands, (c) => `${c.title} ${c.k}`, 3, 60).forEach((c, i) =>
      out.push({ id: `cmd${i}`, group: G.cmd, title: c.title, icon: <Icon name={c.icon} size={16} />, run: c.run }),
    );
    ranked(recent, (f) => f.name, 4, 60).forEach((f) =>
      out.push({ id: `f:${f.path}`, group: G.files, title: f.name, icon: <AppIcon path={f.path} fallback="file" />, run: () => void api.launchOpen(f.path) }),
    );

    if (claude?.installed && claude.loggedIn) {
      out.push({
        id: "claude",
        group: G.more,
        title: tr(`Tanya Claude: "${query}"`, `Ask Claude: "${query}"`),
        icon: <Icon name="chat" size={16} />,
        run: () => {
          expand("chat");
          void sendMessage(query);
          return true;
        },
      });
    }
    out.push({
      id: "web",
      group: G.more,
      title: tr(`Cari di web: "${query}"`, `Search the web: "${query}"`),
      icon: <Icon name="link" size={16} />,
      run: () => void openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`),
    });
    return out;
  }, [q, apps, recent, fx, cur, curKey, claude, settings?.petMode, timer.running, quiet]);

  const run = async (item: Item | undefined) => {
    if (!item) return;
    const keep = await item.run();
    if (keep !== true) collapse();
  };

  // Tinggi notch ngikutin banyaknya hasil (judul grup + baris).
  useEffect(() => {
    const groups = new Set(items.map((i) => i.group)).size;
    paletteHeightStore.set(Math.max(150, Math.min(400, 20 + 46 + 6 + groups * 24 + items.length * 36 + 10)));
  }, [items]);

  // Item yang dipilih selalu keliatan.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  return (
    <div className="palette" onClick={(e) => e.stopPropagation()}>
      <div className="pal-search">
        <Icon name="search" size={17} />
        <input
          ref={input}
          value={q}
          spellCheck={false}
          placeholder={tr("Buka app, hitung, kurs, atau tanya Claude…", "Open an app, calculate, convert, or ask Claude…")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void run(items[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              // Jangan sampai Esc ikut nutup notch kalau cuma mau ngosongin ketikan.
              e.stopPropagation();
              if (q) setQ("");
              else collapse();
            }
          }}
        />
        {copied && <span className="pal-copied">{tr("Tersalin", "Copied")}</span>}
        <kbd>Esc</kbd>
      </div>
      <div className="pal-list" ref={list} role="listbox">
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <div key={it.id + i}>
              {head && <div className="pal-group">{head}</div>}
              <button
                data-i={i}
                role="option"
                aria-selected={i === sel}
                className={`pal-item${i === sel ? " on" : ""}`}
                onMouseMove={() => i !== sel && setSel(i)}
                onClick={() => void run(it)}
              >
                <span className="pal-icon">{it.icon}</span>
                <span className="pal-title ellipsis">{it.title}</span>
                {it.sub && <span className="pal-sub">{it.sub}</span>}
                {i === sel && <span className="pal-enter">↵</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
