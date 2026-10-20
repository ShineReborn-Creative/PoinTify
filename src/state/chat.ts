import { listen } from "@tauri-apps/api/event";
import { api, type ClaudeStatus } from "../lib/api";
import { uid } from "../lib/format";
import { createStore } from "../lib/store";
import { settingsStore } from "./settings";

// ---- Bentuk pesan di tampilan ----

export type TextSeg = { kind: "text"; text: string };
export type ToolSeg = {
  kind: "tool";
  id: string;
  name: string;
  input: Record<string, unknown> | null;
  status: "running" | "done" | "error";
};
export type Seg = TextSeg | ToolSeg;

export type Message = {
  id: string;
  role: "user" | "assistant" | "error";
  segs: Seg[];
  attachments?: string[];
  at: number;
};

export type ChatState = {
  /** Folder project yang dipakai (string kosong = tanpa project). */
  key: string;
  sessionId: string | null;
  messages: Message[];
  /** Potongan jawaban yang lagi ngalir dan belum utuh. */
  live: Seg[];
  running: boolean;
  runId: string | null;
  attachments: string[];
  lastActivity: "idle" | "thinking" | "working" | "done" | "error";
};

const MAX_MESSAGES = 80;

function storageKey(key: string) {
  return `pointify.chat.v1.${key || "_"}`;
}

function loadChat(key: string): ChatState {
  const empty: ChatState = {
    key,
    sessionId: null,
    messages: [],
    live: [],
    running: false,
    runId: null,
    attachments: [],
    lastActivity: "idle",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(key)) ?? "null") as
      | { sessionId: string | null; messages: Message[] }
      | null;
    if (!saved) return empty;
    return { ...empty, sessionId: saved.sessionId, messages: saved.messages ?? [] };
  } catch {
    return empty;
  }
}

function persist(s: ChatState) {
  try {
    localStorage.setItem(
      storageKey(s.key),
      JSON.stringify({ sessionId: s.sessionId, messages: s.messages.slice(-MAX_MESSAGES) }),
    );
  } catch {
    /* abaikan */
  }
}

export const chatStore = createStore<ChatState>(loadChat(""));
export const claudeStatusStore = createStore<ClaudeStatus | null>(null);
export const claudeStatusLoading = createStore(false);

type FinishHandler = (ok: boolean, summary: string) => void;
const finishHandlers = new Set<FinishHandler>();
export function onClaudeFinished(fn: FinishHandler) {
  finishHandlers.add(fn);
  return () => {
    finishHandlers.delete(fn);
  };
}

function patch(p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) {
  chatStore.set((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
}

/** Pindah ke chat milik project lain (masing-masing punya sesi sendiri). */
export function switchChatProject(path: string | null) {
  const key = path ?? "";
  const current = chatStore.get();
  if (current.key === key) return;
  if (current.running && current.runId) void api.claudeStop(current.runId);
  chatStore.set(loadChat(key));
}

export function newChat() {
  const s = chatStore.get();
  if (s.running && s.runId) void api.claudeStop(s.runId);
  const fresh = { ...loadChat(""), key: s.key, sessionId: null, messages: [] };
  chatStore.set(fresh);
  persist(fresh);
}

export function attach(paths: string[]) {
  patch((s) => ({ attachments: Array.from(new Set([...s.attachments, ...paths])) }));
}

export function detach(path: string) {
  patch((s) => ({ attachments: s.attachments.filter((p) => p !== path) }));
}

export async function refreshClaudeStatus() {
  claudeStatusLoading.set(true);
  try {
    claudeStatusStore.set(await api.claudeStatus());
  } finally {
    claudeStatusLoading.set(false);
  }
}

export async function sendMessage(text: string) {
  const prompt = text.trim();
  const s = chatStore.get();
  const settings = settingsStore.get();
  if (!prompt || s.running || !settings) return;

  const runId = uid();
  const userMsg: Message = {
    id: uid(),
    role: "user",
    segs: [{ kind: "text", text: prompt }],
    attachments: s.attachments.length ? s.attachments : undefined,
    at: Date.now(),
  };
  const attachments = s.attachments;
  patch((st) => ({
    messages: [...st.messages, userMsg],
    live: [],
    running: true,
    runId,
    attachments: [],
    lastActivity: "thinking",
  }));
  persist(chatStore.get());

  try {
    await api.claudeSend({
      chatId: runId,
      prompt,
      cwd: s.key || null,
      sessionId: s.sessionId,
      // Mode Kerjain cuma boleh kalau ada folder project, biar Claude nggak ngedit sembarang tempat.
      mode: settings.claudeMode === "work" && s.key ? "work" : "chat",
      model: settings.claudeModel || "opus",
      effort: settings.claudeEffort || "high",
      attachments,
    });
  } catch (err) {
    fail(String(err));
  }
}

export function stopMessage() {
  const s = chatStore.get();
  if (s.runId) void api.claudeStop(s.runId);
}

function fail(text: string) {
  patch((s) => ({
    running: false,
    runId: null,
    live: [],
    lastActivity: "error",
    messages: [...s.messages, { id: uid(), role: "error", segs: [{ kind: "text", text }], at: Date.now() }],
  }));
  persist(chatStore.get());
  finishHandlers.forEach((fn) => fn(false, text));
}

// ---- Membaca aliran JSON dari Claude Code ----

type Json = Record<string, any>;

function segsFromContent(content: unknown): Seg[] {
  if (!Array.isArray(content)) return [];
  const segs: Seg[] = [];
  for (const block of content as Json[]) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      segs.push({ kind: "text", text: block.text });
    } else if (block?.type === "tool_use") {
      segs.push({
        kind: "tool",
        id: String(block.id ?? uid()),
        name: String(block.name ?? "Tool"),
        input: (block.input as Record<string, unknown>) ?? null,
        status: "running",
      });
    }
  }
  return segs;
}

function handleEvent(ev: Json) {
  const type = ev?.type;
  // Pesan dari subagent nggak ditampilin satu-satu.
  if (ev?.parent_tool_use_id) return;

  if (type === "system" && ev.subtype === "init" && ev.session_id) {
    patch({ sessionId: String(ev.session_id) });
    return;
  }

  if (type === "stream_event") {
    const e = ev.event as Json;
    if (e?.type === "content_block_start") {
      const block = e.content_block as Json;
      if (block?.type === "text") {
        patch((s) => ({ live: [...s.live, { kind: "text", text: block.text ?? "" }], lastActivity: "thinking" }));
      } else if (block?.type === "tool_use") {
        patch((s) => ({
          live: [
            ...s.live,
            { kind: "tool", id: String(block.id), name: String(block.name), input: null, status: "running" },
          ],
          lastActivity: "working",
        }));
      }
    } else if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
      const piece = String(e.delta.text ?? "");
      patch((s) => {
        const live = [...s.live];
        const last = live[live.length - 1];
        if (last?.kind === "text") live[live.length - 1] = { ...last, text: last.text + piece };
        else live.push({ kind: "text", text: piece });
        return { live };
      });
    }
    return;
  }

  if (type === "assistant") {
    const segs = segsFromContent(ev.message?.content);
    if (!segs.length) {
      patch({ live: [] });
      return;
    }
    patch((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      // Gabung ke balon asisten terakhir biar satu giliran jadi satu balon.
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, segs: [...last.segs, ...segs] };
      } else {
        messages.push({ id: uid(), role: "assistant", segs, at: Date.now() });
      }
      const hasTool = segs.some((x) => x.kind === "tool");
      return { messages, live: [], lastActivity: hasTool ? "working" : "thinking" };
    });
    return;
  }

  if (type === "user") {
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    const results = new Map<string, boolean>();
    for (const block of content as Json[]) {
      if (block?.type === "tool_result" && block.tool_use_id) {
        results.set(String(block.tool_use_id), Boolean(block.is_error));
      }
    }
    if (!results.size) return;
    patch((s) => ({
      messages: s.messages.map((m) =>
        m.role !== "assistant"
          ? m
          : {
              ...m,
              segs: m.segs.map((seg) =>
                seg.kind === "tool" && results.has(seg.id)
                  ? { ...seg, status: results.get(seg.id) ? "error" : "done" }
                  : seg,
              ),
            },
      ),
    }));
    return;
  }

  if (type === "result") {
    const ok = ev.subtype === "success" && !ev.is_error;
    const resultText = typeof ev.result === "string" ? ev.result : "";
    patch((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      const answered = last?.role === "assistant" && last.segs.some((x) => x.kind === "text");
      if (!ok) {
        // Claude Code juga ngirim pesan error-nya sebagai balon jawaban.
        // Buang balon itu biar errornya nggak tampil dua kali.
        if (last?.role === "assistant" && resultText) {
          const segs = last.segs.filter((x) => !(x.kind === "text" && x.text.trim() === resultText.trim()));
          if (segs.length) messages[messages.length - 1] = { ...last, segs };
          else messages.pop();
        }
        messages.push({
          id: uid(),
          role: "error",
          segs: [{ kind: "text", text: resultText || describeFailure(ev.subtype) }],
          at: Date.now(),
        });
      } else if (!answered && resultText) {
        messages.push({ id: uid(), role: "assistant", segs: [{ kind: "text", text: resultText }], at: Date.now() });
      }
      return {
        messages,
        live: [],
        running: false,
        runId: null,
        sessionId: ev.session_id ? String(ev.session_id) : s.sessionId,
        lastActivity: ok ? "done" : "error",
      };
    });
    persist(chatStore.get());
    // Login kedaluwarsa: tampilkan lagi kartu login di tab Chat.
    if (!ok && isAuthError(resultText)) markLoggedOut();
    finishHandlers.forEach((fn) => fn(ok, resultText));
  }
}

function isAuthError(text: string): boolean {
  return /authenticat|oauth|not logged in|log in|login|credential|unauthorized|401/i.test(text);
}

function markLoggedOut() {
  const status = claudeStatusStore.get();
  if (status) claudeStatusStore.set({ ...status, loggedIn: false });
}

function describeFailure(subtype: unknown): string {
  switch (subtype) {
    case "error_max_turns":
      return "Claude berhenti karena kebanyakan langkah. Coba pecah permintaannya jadi lebih kecil.";
    case "error_during_execution":
      return "Ada error waktu Claude lagi kerja. Coba kirim lagi.";
    default:
      return "Claude nggak berhasil nyelesaiin permintaan ini.";
  }
}

function explainStderr(stderr: string, code: number | null): string {
  const lower = stderr.toLowerCase();
  if (lower.includes("login") || lower.includes("auth") || lower.includes("credential")) {
    return "Claude Code belum login. Buka Pengaturan, bagian Claude, terus klik Login.";
  }
  if (code === null) return "Dihentikan.";
  const tail = stderr.trim().split("\n").slice(-3).join("\n");
  return tail ? `Claude Code berhenti (kode ${code}):\n${tail}` : `Claude Code berhenti dengan kode ${code}.`;
}

export async function initChat() {
  // Mulai dari project yang terakhir dipilih.
  switchChatProject(settingsStore.get()?.activeProject ?? null);

  await listen<{ chatId: string; event: Json }>("claude-event", (e) => {
    if (e.payload.chatId !== chatStore.get().runId) return;
    handleEvent(e.payload.event);
  });

  await listen<{ chatId: string; code: number | null; stderr: string }>("claude-done", (e) => {
    const s = chatStore.get();
    if (e.payload.chatId !== s.runId) return;
    // Kalau event "result" udah datang, `running` udah false.
    if (!s.running) return;
    if (s.live.length || s.messages[s.messages.length - 1]?.role === "assistant") {
      // Dihentikan di tengah jalan: simpan potongan yang udah sempat keluar.
      patch((st) => {
        const messages = [...st.messages];
        const partial = st.live.filter((x) => x.kind === "tool" || x.text.trim());
        if (partial.length) {
          const last = messages[messages.length - 1];
          if (last?.role === "assistant") {
            messages[messages.length - 1] = { ...last, segs: [...last.segs, ...partial] };
          } else {
            messages.push({ id: uid(), role: "assistant", segs: partial, at: Date.now() });
          }
        }
        return {
          messages,
          running: false,
          runId: null,
          live: [],
          lastActivity: e.payload.code === 0 ? "done" : "idle",
        };
      });
      persist(chatStore.get());
      return;
    }
    if (isAuthError(e.payload.stderr)) markLoggedOut();
    fail(explainStderr(e.payload.stderr, e.payload.code));
  });

  void refreshClaudeStatus();
}
