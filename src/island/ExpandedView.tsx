import { ErrorBoundary } from "../components/ErrorBoundary";
import { Palette } from "./Palette";
import { Icon, type IconName } from "../components/Icon";
import { Pip, type PipMood } from "../components/Pip";
import { canvasPipStore } from "../state/pipSpot";
import { dragPipOut } from "../state/pet";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { agentsStore } from "../state/agents";
import { chatStore, claudeStatusStore } from "../state/chat";
import { mediaStore } from "../state/media";
import { MusicTab } from "./tabs/MusicTab";
import { islandStore, setTab, type Tab } from "../state/island";
import { settingsStore, updateSettings } from "../state/settings";
import { shelfStore } from "../state/shelf";
import { timerStore } from "../state/timer";
import { AgentsTab } from "./tabs/AgentsTab";
import { ChatTab } from "./tabs/ChatTab";
import { EditToggle, WidgetCanvas } from "../widgets/WidgetCanvas";
import { ShelfTab } from "./tabs/ShelfTab";
import { TimerTab } from "./tabs/TimerTab";
import { tr } from "../i18n";

/**
 * Beranda & Rak selalu ada. Musik nongol pas ada lagu, Fokus pas timer jalan
 * (atau dibuka dari widget/cincin timer). Claude dipisah di ujung.
 */
const MAIN_TABS: { id: Tab; label: () => string; icon: IconName }[] = [
  { id: "home", label: () => tr("Beranda", "Home"), icon: "home" },
  { id: "shelf", label: () => tr("Rak", "Shelf"), icon: "shelf" },
  { id: "music", label: () => tr("Musik", "Music"), icon: "music" },
  { id: "timer", label: () => tr("Fokus", "Focus"), icon: "timer" },
];

/** Bagian Claude yang terakhir dibuka, biar klik tab Claude balik ke situ. */
let lastClaudeTab: "chat" | "agents" = "chat";

export function ExpandedView({ mood }: { mood: PipMood }) {
  const island = useStore(islandStore);
  const settings = useStore(settingsStore);
  const shelf = useStore(shelfStore);
  const chat = useStore(chatStore);
  const timer = useStore(timerStore);
  const agents = useStore(agentsStore);
  const claude = useStore(claudeStatusStore);
  const media = useStore(mediaStore);
  const shown = (id: Tab) =>
    island.tab === id || (id === "music" ? !!media && media.kind !== "video" : id === "timer" ? timer.running : true);

  const onClaude = island.tab === "chat" || island.tab === "agents";
  if (onClaude) lastClaudeTab = island.tab as "chat" | "agents";
  // Claude belum kepasang dan nggak ada sesi: tab-nya nggak usah nongol.
  const showClaude = onClaude || claude?.installed !== false || agents.sessions.length > 0;
  const sessionsBusy = agents.sessions.some((s) => s.status === "working");
  const sessionsWaiting = agents.sessions.some((s) => s.status === "waiting");
  const claudeDot = sessionsWaiting ? "warn" : chat.running || sessionsBusy ? "on" : null;

  const badge = (id: Tab): string | null => (id === "shelf" && shelf.length ? String(shelf.length) : null);
  /** Titik kecil = ada yang lagi jalan di tab itu. */
  const busy = (id: Tab) => id === "timer" && timer.running;

  // Command palette: tampilan sendiri, tanpa tab bar.
  if (island.tab === "palette") {
    return (
      <div className="expanded fade-in">
        <Palette />
      </div>
    );
  }

  return (
    <div className="expanded fade-in">
      <nav className="tabbar" onClick={(e) => e.stopPropagation()}>
        <div className="tabbar-left">
        <HeaderPip mood={mood} />
        <div className="tabs" role="tablist">
          {MAIN_TABS.filter((t) => shown(t.id)).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={island.tab === t.id}
              aria-label={t.label()}
              title={island.tab === t.id ? undefined : t.label()}
              className={`tab${island.tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              <span className="tab-label">{t.label()}</span>
              {badge(t.id) && <span className="tab-badge">{badge(t.id)}</span>}
              {busy(t.id) && <span className="tab-dot" aria-label={tr("lagi jalan", "running")} />}
            </button>
          ))}
          {showClaude && (
            <>
              <span className="tab-sep" aria-hidden="true" />
              <button
                role="tab"
                aria-selected={onClaude}
                aria-label="Claude"
                title={onClaude ? undefined : "Claude"}
                className={`tab tab-claude${onClaude ? " active" : ""}`}
                onClick={() => setTab(lastClaudeTab)}
              >
                <Icon name="sparkle" size={16} />
                <span className="tab-label">Claude</span>
                {claudeDot && (
                  <span
                    className={`tab-dot${claudeDot === "warn" ? " warn" : ""}`}
                    aria-label={claudeDot === "warn" ? tr("nunggu jawaban lu", "waiting for you") : tr("lagi jalan", "running")}
                  />
                )}
              </button>
            </>
          )}
        </div>
        </div>
        <div className="tabbar-right">
          {island.tab === "home" && <EditToggle />}
          {onClaude && (
            <div className="segmented small claude-seg" role="tablist" aria-label="Claude">
              <button role="tab" aria-selected={island.tab === "chat"} className={island.tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
                Chat
                {chat.running && <span className="tab-dot" />}
              </button>
              <button role="tab" aria-selected={island.tab === "agents"} className={island.tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}>
                {tr("Sesi", "Sessions")}
                {agents.sessions.length > 0 && <span className={`seg-count${sessionsWaiting ? " warn" : ""}`}>{agents.sessions.length}</span>}
              </button>
            </div>
          )}
          <button
            className="icon-btn"
            aria-label={settings?.sounds ? tr("Matikan suara", "Mute sounds") : tr("Nyalakan suara", "Unmute sounds")}
            title={settings?.sounds ? tr("Suara nyala", "Sounds on") : tr("Suara mati", "Sounds off")}
            onClick={() => updateSettings({ sounds: !settings?.sounds })}
          >
            <Icon name={settings?.sounds ? "volume" : "volumeOff"} size={16} />
          </button>
          <button className="icon-btn" aria-label={tr("Pengaturan", "Settings")} title={tr("Pengaturan", "Settings")} onClick={() => void api.settingsOpen()}>
            <Icon name="gear" size={16} />
          </button>
        </div>
      </nav>
      <div className="tab-body">
        <ErrorBoundary label={tr("Tab ini", "This tab")} resetKey={island.tab}>
        {island.tab === "home" && <WidgetCanvas mood={mood} />}
        {island.tab === "chat" && <ChatTab mood={mood} />}
        {island.tab === "agents" && <AgentsTab mood={mood} />}
        {island.tab === "shelf" && <ShelfTab mood={mood} />}
        {island.tab === "timer" && <TimerTab />}
        {island.tab === "music" && <MusicTab mood={mood} />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

/**
 * Pip di pojok tab bar: maskotnya selalu ada walau Beranda nggak punya widget
 * Pip. Tarik ke bawah buat bawa dia ke desktop. Kalau lagi di desktop, titik
 * kecilnya bisa diklik buat manggil dia balik.
 */
function HeaderPip({ mood }: { mood: PipMood }) {
  const settings = useStore(settingsStore);
  const island = useStore(islandStore);
  const onCanvas = useStore(canvasPipStore);
  if (settings?.petMode) {
    return (
      <button className="header-pip-away" title={tr("Pip lagi di desktop. Klik buat manggil balik.", "Pip is on the desktop. Click to call him back.")} aria-label={tr("Panggil Pip balik", "Call Pip back")} onClick={() => void api.petHome()}>
        <i />
      </button>
    );
  }
  if (island.tab === "home" && onCanvas > 0) return null;
  return (
    <span className="header-pip" title={tr("Klik buat nyolek, tarik ke bawah buat bawa ke desktop", "Click to poke, drag down to take Pip to the desktop")}>
      <Pip mood={mood} size={24} interactive onDragOut={dragPipOut} />
    </span>
  );
}
