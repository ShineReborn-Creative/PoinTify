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
  /** Lirik jalan di tengah notch kecil. */
  compactLyrics: boolean;
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
  petMode: boolean;
  petWander: boolean;
  petPos: [number, number] | null;
  /** Kanvas widget Beranda (bentuknya diatur src/widgets/layout.ts). */
  widgets: unknown;
};

export type SysStats = {
  cpu: number;
  memUsed: number;
  memTotal: number;
  diskFree: number;
  diskTotal: number;
  battery: { percent: number; charging: boolean } | null;
  netDown: number;
  netUp: number;
};

export type ClipItem = { text: string; at: number };

export type CarryResult = { moved: boolean; home: boolean };

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

export type AgentStep = {
  id: number;
  at: number;
  kind: "prompt" | "tool" | "task" | "todo";
  tool: string | null;
  detail: string;
  target: string | null;
  added: number | null;
  removed: number | null;
  ok: boolean | null;
};

export type AgentSession = {
  id: string;
  /** "terminal" = Claude Code lewat hooks, "chat" = chat Claude yang ngabarin lewat folder feed. */
  source: "terminal" | "chat";
  cwd: string;
  project: string;
  status: "working" | "waiting" | "idle" | "ended";
  title: string | null;
  lastMessage: string | null;
  startedAt: number;
  updatedAt: number;
  steps: AgentStep[];
};

export type AgentQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

export type PendingRequest = {
  id: string;
  kind: "permission" | "question";
  sessionId: string;
  project: string;
  chatId: string | null;
  tool: string;
  detail: string;
  target: string | null;
  alwaysLabel: string | null;
  questions: AgentQuestion[] | null;
  createdAt: number;
};

export type AgentsSnapshot = { sessions: AgentSession[]; pending: PendingRequest[] };

export type AgentAnswer =
  | { action: "allow" | "always" | "deny" | "terminal" }
  | { action: "answer"; answers: Record<string, string> };

export type HooksStatus = {
  state: "installed" | "outdated" | "partial" | "missing";
  settingsPath: string;
  exePath: string;
  preview: string;
  error: string | null;
};

export type HooksInstallResult = { status: HooksStatus; backupPath: string | null };

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
  shelfDiagnose: () => invoke<{ elevated: boolean }>("shelf_diagnose"),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<Settings>("settings_set", { settings }),
  settingsOpen: () => invoke("settings_open"),

  claudeStatus: () => invoke<ClaudeStatus>("claude_status"),
  claudeSend: (req: ClaudeSendRequest) => invoke("claude_send", { req }),
  claudeStop: (chatId: string) => invoke("claude_stop", { chatId }),
  claudeLogin: () => invoke("claude_login"),
  claudeOpenDesktop: (sessionId: string | null, cwd: string | null) =>
    invoke("claude_open_desktop", { sessionId, cwd }),

  agentsSnapshot: () => invoke<AgentsSnapshot>("agents_snapshot"),
  agentsRespond: (id: string, answer: AgentAnswer) => invoke("agents_respond", { id, answer }),
  agentsDismiss: (sessionId: string) => invoke("agents_dismiss", { sessionId }),
  hooksStatus: () => invoke<HooksStatus>("hooks_status"),
  hooksInstall: () => invoke<HooksInstallResult>("hooks_install"),
  hooksUninstall: () => invoke<HooksInstallResult>("hooks_uninstall"),

  petShow: () => invoke("pet_show"),
  petSpawnCarry: () => invoke<CarryResult>("pet_spawn_carry"),
  petCarry: (grabX: number, grabY: number) => invoke<CarryResult>("pet_carry", { grabX, grabY }),
  petDrop: () => invoke("pet_drop"),
  petHome: () => invoke("pet_home"),
  petSetHit: (rect: { x: number; y: number; w: number; h: number }) => invoke("pet_set_hit", { rect }),
  petWander: () => invoke<number>("pet_wander"),
  petVisit: (offset: number) => invoke("pet_visit", { offset }),
  petReturn: () => invoke("pet_return"),

  sysStats: () => invoke<SysStats>("sys_stats"),
  sysMediaKey: (action: "volumeUp" | "volumeDown" | "mute") => invoke("sys_media_key", { action }),
  sysMic: (toggle: boolean) => invoke<boolean>("sys_mic", { toggle }),
  clipboardList: () => invoke<ClipItem[]>("clipboard_list"),
  clipboardCopy: (text: string) => invoke("clipboard_copy", { text }),
  clipboardClear: () => invoke("clipboard_clear"),
  httpGetJson: <T = unknown>(url: string) => invoke<T>("http_get_json", { url }),
  launchOpen: (target: string) => invoke("launch_open", { target }),
  /** Ikon asli app/file/folder/situs (data URL), null kalau nggak ada. */
  /** Lokasi PC dari layanan lokasi Windows. */
  geoLocate: () => invoke<{ lat: number; lon: number; accuracy: number }>("geo_locate"),
  launchIcon: (target: string) => invoke<string | null>("launch_icon", { target }),
};
