import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import { IslandApp } from "./island/IslandApp";
import { SettingsApp } from "./settings/SettingsApp";
import { initChat } from "./state/chat";
import { initMedia } from "./state/media";
import { initSettings } from "./state/settings";
import { initShelf } from "./state/shelf";
import "./styles/base.css";
import "./styles/pip.css";

async function boot() {
  const label = getCurrentWindow().label;
  document.documentElement.dataset.window = label;
  await initSettings();

  if (label === "settings") {
    await import("./styles/settings.css");
  } else {
    await import("./styles/island.css");
    await Promise.all([initMedia(), initShelf()]);
    await initChat();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{label === "settings" ? <SettingsApp /> : <IslandApp />}</React.StrictMode>,
  );
}

void boot();
