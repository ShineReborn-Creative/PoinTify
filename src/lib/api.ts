import { invoke } from "@tauri-apps/api/core";

// ---- Tipe data yang dikirim Rust ----

export type MediaInfo = {
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  appId: string;
  thumbnail: string | null;
  positionMs: number;
  positionAtMs: number;
  durationMs: number;
};

export type LyricLine = { timeMs: number; text: string };

export type ShelfItem = {
  id: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  isDir: boolean;
  addedAt: number;
};

export type Project = { name: string; path: string };

export type Settings = {
  openOnHover: boolean;
  hoverDelayMs: number;
  hideInFullscreen: boolean;
  launchAtStartup: boolean;
  shortcut: string;
  sounds: boolean;
  showLyrics: boolean;
  lyricOffsetMs: number;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  waterEnabled: boolean;
  waterIntervalMinutes: number;
  waterGoal: number;
  waterStartHour: number;
  waterEndHour: number;
  claudePath: string;
  claudeModel: string;
  claudeEffort: string;
  claudeMode: string;
  projects: Project[];
  activeProject: string | null;
};

export type ClaudeStatus = {
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  account: string | null;
};

export type ClaudeSendRequest = {
  chatId: string;
  prompt: string;
  cwd: string | null;
  sessionId: string | null;
  mode: "chat" | "work";
  model: string;
  effort: string;
  attachments: string[];
};

// ---- Pembungkus command ----

export const api = {
  setHit: (rect: { x: number; y: number; w: number; h: number }) =>
    invoke("island_set_hit", { rect }),
  focusIsland: () => invoke("island_focus"),

  mediaGet: () => invoke<MediaInfo | null>("media_get"),
  mediaControl: (action: "prev" | "toggle" | "next") => invoke("media_control", { action }),
  mediaSeek: (positionMs: number) => invoke("media_seek", { positionMs: Math.round(positionMs) }),
  lyricsFetch: (m: MediaInfo) =>
    invoke<LyricLine[] | null>("lyrics_fetch", {
      title: m.title,
      artist: m.artist,
      album: m.album,
      durationMs: m.durationMs,
    }),

  shelfList: () => invoke<ShelfItem[]>("shelf_list"),
  shelfAdd: (paths: string[]) => invoke<ShelfItem[]>("shelf_add", { paths }),
  shelfRemove: (id: string) => invoke<ShelfItem[]>("shelf_remove", { id }),
  shelfClear: () => invoke<ShelfItem[]>("shelf_clear"),
  shelfOpen: (id: string) => invoke("shelf_open", { id }),
  shelfReveal: (id: string) => invoke("shelf_reveal", { id }),
  shelfDragIcon: () => invoke<string>("shelf_drag_icon"),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  settingsOpen: () => invoke("settings_open"),

  claudeStatus: () => invoke<ClaudeStatus>("claude_status"),
  claudeSend: (req: ClaudeSendRequest) => invoke("claude_send", { req }),
  claudeStop: (chatId: string) => invoke("claude_stop", { chatId }),
  claudeLogin: () => invoke("claude_login"),
  claudeOpenDesktop: (sessionId: string | null, cwd: string | null) =>
    invoke("claude_open_desktop", { sessionId, cwd }),
};
