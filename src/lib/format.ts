import { tr } from "../i18n";

export function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Nama app dari ID media Windows, misalnya "Spotify.exe" -> "Spotify". */
export function appName(appId: string): string {
  const id = appId.toLowerCase();
  if (id.includes("spotify")) return "Spotify";
  if (id.includes("chrome")) return "Chrome";
  if (id.includes("msedge") || id.includes("edge")) return "Edge";
  if (id.includes("firefox")) return "Firefox";
  if (id.includes("zunemusic") || id.includes("media")) return "Media Player";
  if (id.includes("vlc")) return "VLC";
  if (id.includes("youtube")) return "YouTube Music";
  const base = appId.split(/[\\/!]/).pop() ?? appId;
  return base.replace(/\.exe$/i, "") || tr("Musik", "Music");
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 4) return tr("Begadang ya?", "Up late?");
  if (h < 11) return tr("Pagi!", "Morning!");
  if (h < 15) return tr("Siang!", "Afternoon!");
  if (h < 18) return tr("Sore!", "Evening!");
  return tr("Malam!", "Good night!");
}

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
