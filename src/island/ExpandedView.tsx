import { Icon, type IconName } from "../components/Icon";
import type { PipMood } from "../components/Pip";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { agentsStore } from "../state/agents";
import { chatStore } from "../state/chat";
import { islandStore, setTab, type Tab } from "../state/island";
import { settingsStore, updateSettings } from "../state/settings";
import { shelfStore } from "../state/shelf";
import { timerStore } from "../state/timer";
import { AgentsTab } from "./tabs/AgentsTab";
import { ChatTab } from "./tabs/ChatTab";
import { EditToggle, WidgetCanvas } from "../widgets/WidgetCanvas";
import { ShelfTab } from "./tabs/ShelfTab";
import { TimerTab } from "./tabs/TimerTab";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Beranda", icon: "home" },
  { id: "chat", label: "Chat", icon: "chat" },
  { id: "agents", label: "Sesi", icon: "terminal" },
  { id: "shelf", label: "Rak", icon: "shelf" },
  { id: "timer", label: "Fokus", icon: "timer" },
];

export function ExpandedView({ mood }: { mood: PipMood }) {
  const island = useStore(islandStore);
  const settings = useStore(settingsStore);
  const shelf = useStore(shelfStore);
  const chat = useStore(chatStore);
  const timer = useStore(timerStore);
  const agents = useStore(agentsStore);

  const badge = (id: Tab): string | null => (id === "shelf" && shelf.length ? String(shelf.length) : null);
  /** Titik kecil = ada yang lagi jalan di tab itu. */
  const busy = (id: Tab) =>
    (id === "chat" && chat.running) ||
    (id === "timer" && timer.running) ||
    (id === "agents" && agents.sessions.some((s) => s.status === "working" || s.status === "waiting"));

  return (
    <div className="expanded fade-in">
      <nav className="tabbar" onClick={(e) => e.stopPropagation()}>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={island.tab === t.id}
              className={`tab${island.tab === t.id ? " active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              <span className="tab-label">{t.label}</span>
              {badge(t.id) && <span className="tab-badge">{badge(t.id)}</span>}
              {busy(t.id) && <span className="tab-dot" aria-label="lagi jalan" />}
            </button>
          ))}
        </div>
        <div className="tabbar-right">
          {island.tab === "home" && <EditToggle />}
          <button
            className="icon-btn"
            aria-label={settings?.sounds ? "Matikan suara" : "Nyalakan suara"}
            title={settings?.sounds ? "Suara nyala" : "Suara mati"}
            onClick={() => updateSettings({ sounds: !settings?.sounds })}
          >
            <Icon name={settings?.sounds ? "volume" : "volumeOff"} size={16} />
          </button>
          <button className="icon-btn" aria-label="Pengaturan" title="Pengaturan" onClick={() => void api.settingsOpen()}>
            <Icon name="gear" size={16} />
          </button>
        </div>
      </nav>
      <div className="tab-body">
        {island.tab === "home" && <WidgetCanvas mood={mood} />}
        {island.tab === "chat" && <ChatTab mood={mood} />}
        {island.tab === "agents" && <AgentsTab mood={mood} />}
        {island.tab === "shelf" && <ShelfTab mood={mood} />}
        {island.tab === "timer" && <TimerTab />}
      </div>
    </div>
  );
}
