import { listen } from "@tauri-apps/api/event";
import { api, type AgentAnswer, type AgentSession, type AgentsSnapshot } from "../lib/api";
import { createStore } from "../lib/store";

/** Sesi Claude Code di terminal plus permintaan izin/pertanyaan yang lagi nunggu. */
export const agentsStore = createStore<AgentsSnapshot>({ sessions: [], pending: [] });

type Finished = { sessionId: string; project: string; message: string; ok: boolean };
const finishedHandlers = new Set<(f: Finished) => void>();

export function onAgentFinished(fn: (f: Finished) => void) {
  finishedHandlers.add(fn);
  return () => {
    finishedHandlers.delete(fn);
  };
}

export async function initAgents() {
  try {
    const snap = await api.agentsSnapshot();
    if (snap?.sessions) agentsStore.set(snap);
  } catch {
    // Server belum siap: snapshot berikutnya datang lewat event.
  }
  void listen<AgentsSnapshot>("agents-changed", (e) => agentsStore.set(e.payload));
  void listen<Finished>("agent-finished", (e) => finishedHandlers.forEach((fn) => fn(e.payload)));
}

export async function answerRequest(id: string, answer: AgentAnswer) {
  // Langsung hilangin dari layar biar kerasa cepat; Rust ngirim snapshot baru.
  agentsStore.set((s) => ({ ...s, pending: s.pending.filter((p) => p.id !== id) }));
  try {
    await api.agentsRespond(id, answer);
  } catch {
    // Claude udah nggak nunggu (misalnya dijawab/dibatalin di terminal).
  }
}

/** Sesi yang lagi dikerjain Claude (buat notch kecil & mood Pip). */
export function activeSession(s: AgentsSnapshot): AgentSession | null {
  return s.sessions.find((x) => x.status === "working") ?? null;
}
