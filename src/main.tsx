import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import { IslandApp } from "./island/IslandApp";
import { SettingsApp } from "./settings/SettingsApp";
import { initAgents } from "./state/agents";
import { initChat } from "./state/chat";
import { initMedia } from "./state/media";
import { initSettings } from "./state/settings";
import { initShelf } from "./state/shelf";
import { setPointer } from "./pip/engine";
import "./styles/base.css";
import "./styles/pip.css";

async function boot() {
  const label = getCurrentWindow().label;
  document.documentElement.dataset.window = label;
  await initSettings();

  // Mata Pip ngikutin kursor: dari DOM kalau kursornya di dalam jendela,
  // dan (khusus notch) dari Rust kalau kursornya di mana pun di layar.
  window.addEventListener("pointermove", (e) => setPointer(e.clientX, e.clientY), { passive: true });
  if (label !== "settings") {
    void listen<{ x: number; y: number }>("cursor-pos", (e) => setPointer(e.payload.x, e.payload.y));
  }

  if (label === "settings") {
    await import("./styles/settings.css");
  } else {
    await import("./styles/island.css");
    await Promise.all([initMedia(), initShelf(), initAgents()]);
    await initChat();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{label === "settings" ? <SettingsApp /> : <IslandApp />}</React.StrictMode>,
  );
}

void boot();
