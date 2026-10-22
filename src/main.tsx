import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IslandApp } from "./island/IslandApp";
import { PetApp } from "./pet/PetApp";
import { SettingsApp } from "./settings/SettingsApp";
import { initAgents } from "./state/agents";
import { initChat } from "./state/chat";
import { initDownloads } from "./state/downloads";
import { initStats } from "./state/stats";
import { initForeground } from "./state/foreground";
import { initMedia } from "./state/media";
import { initSettings, settingsStore } from "./state/settings";
import { setLanguage, tr } from "./i18n";
import { initTheme } from "./lib/theme";
import { initShelf } from "./state/shelf";
import { setPointer } from "./pip/engine";
import { initClipboard } from "./widgets/data";
import { initWidgets } from "./widgets/layout";
import "./styles/base.css";
import "./styles/pip.css";

async function boot() {
  const label = getCurrentWindow().label;
  document.documentElement.dataset.window = label;
  await initSettings();
  setLanguage(settingsStore.get()?.language);
  initTheme();
  settingsStore.subscribe(() => setLanguage(settingsStore.get()?.language));

  // Mata Pip ngikutin kursor: dari DOM kalau kursornya di dalam jendela,
  // dan (khusus notch) dari Rust kalau kursornya di mana pun di layar.
  window.addEventListener("pointermove", (e) => setPointer(e.clientX, e.clientY), { passive: true });
  if (label !== "settings") {
    void listen<{ x: number; y: number }>(label === "pet" ? "pet-cursor" : "cursor-pos", (e) => setPointer(e.payload.x, e.payload.y));
  }

  if (label === "settings") {
    await import("./styles/settings.css");
  } else if (label === "pet") {
    await import("./styles/pet.css");
  } else {
    await import("./styles/island.css");
    await import("./styles/widgets.css");
    await Promise.all([initMedia(), initShelf(), initAgents(), initForeground(), initDownloads()]);
    await initChat();
    initWidgets();
    initClipboard();
    initStats();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary
        label="PoinTify"
        fallback={() => (
          <div className={`root-error window-${label}`} role="alert">
            <span>{tr("Waduh, ada yang error.", "Oops, something went wrong.")}</span>
            <button className="btn" onClick={() => location.reload()}>
              {tr("Muat ulang", "Reload")}
            </button>
          </div>
        )}
      >
        {label === "settings" ? <SettingsApp /> : label === "pet" ? <PetApp /> : <IslandApp />}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void boot();
