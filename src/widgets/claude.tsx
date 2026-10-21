import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { useNow } from "../lib/hooks";
import { play } from "../lib/sound";
import { useStore } from "../lib/store";
import { toolLabel } from "../lib/tools";
import { agentsStore } from "../state/agents";
import { chatStore, sendMessage } from "../state/chat";
import { setTab, showPeek } from "../state/island";
import { duration, hhmm, num, str, WLabel, WState, type WidgetProps } from "./common";
import { clipStore, initClipboard, setLive } from "./data";
import { setCfg } from "./layout";
import { isEn, tr } from "../i18n";

// ---------------------------------------------------------------------------
// Hitung mundur reset usage Claude
// ---------------------------------------------------------------------------

/** Reset berikutnya: dari jam reset yang lu masukin, maju per siklus sampai lewat sekarang. */
function nextReset(item: WidgetProps["item"], now: number) {
  const base = Date.parse(str(item.cfg.resetAt));
  const cycle = num(item.cfg.cycleHours, 5) * 3_600_000;
  if (!Number.isFinite(base) || cycle <= 0) return null;
  if (base > now) return base;
  return base + Math.ceil((now - base) / cycle) * cycle;
}

const NOTIFIED_KEY = "pointify.usage.notified";

export function UsageWidget({ item, size }: WidgetProps) {
  const now = useNow(1000);
  const next = nextReset(item, now);
  const cycle = num(item.cfg.cycleHours, 5);
  return (
    <div className={`w-usage size-${size}`}>
      <WLabel icon="sparkle">{tr("Usage Claude", "Claude usage")}</WLabel>
      {next === null ? (
        <span className="muted w-hint">{tr("Masukin jam reset berikutnya lewat gerigi di mode Atur.", "Enter the next reset time with the gear in Arrange mode.")}</span>
      ) : (
        <>
          <strong className="w-big tabular">{duration(next - now)}</strong>
          <span className="muted">
            {tr("Reset jam", "Resets at")} {hhmm(new Date(next))}
          </span>
        </>
      )}
      {size !== "s" && (
        <button
          className="w-link w-usage-now"
          title={tr("Pakai ini pas lu baru mulai chat lagi setelah reset", "Use this when you start chatting again right after a reset")}
          onClick={() => setCfg(item.id, { resetAt: new Date(now + cycle * 3_600_000).toISOString() })}
        >
          {tr("Mulai siklus baru sekarang", "Start a new cycle now")}
        </button>
      )}
    </div>
  );
}

export function UsageLive({ item }: WidgetProps) {
  const now = useNow(1000);
  const next = nextReset(item, now);
  const left = next === null ? -1 : next - now;
  const soon = left > 0 && left <= 10 * 60_000;
  useEffect(() => {
    setLive(item.id, soon ? { priority: 5, icon: "sparkle", label: "Usage reset", value: duration(left), tone: "good" } : null);
  }, [item.id, soon ? Math.floor(left / 1000) : -1]);
  // Pas lewat jam reset: kabarin sekali per siklus.
  useEffect(() => {
    if (next === null) return;
    const cycle = num(item.cfg.cycleHours, 5) * 3_600_000;
    const last = next - cycle;
    if (now - last > 60_000) return;
    try {
      if (localStorage.getItem(NOTIFIED_KEY) === String(last)) return;
      localStorage.setItem(NOTIFIED_KEY, String(last));
    } catch {
      return;
    }
    play("done");
    showPeek({
      kind: "info",
      title: tr("Usage Claude udah reset", "Claude usage has reset"),
      body: tr("Gas lanjut ngerjain project.", "Back to work on your project."),
      mood: "happy",
      timeoutMs: 10000,
    });
  }, [next, Math.floor(now / 10_000)]);
  useEffect(() => () => setLive(item.id, null), [item.id]);
  return null;
}

// ---------------------------------------------------------------------------
// Prompt cepat
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPTS = (
  isEn()
    ? [
        "Summarize | Summarize this text into short bullet points:\\n\\n{clipboard}",
        "Explain error | Explain this error and how to fix it:\\n\\n{clipboard}",
        "Translate | Translate this into natural Indonesian (or into English if it's already Indonesian):\\n\\n{clipboard}",
        "Polish | Polish this writing so it reads well, without changing its meaning:\\n\\n{clipboard}",
      ]
    : [
        "Rangkum | Rangkum teks ini jadi poin-poin singkat:\\n\\n{clipboard}",
        "Jelasin error | Jelasin error ini dan cara benerinnya:\\n\\n{clipboard}",
        "Terjemahin | Terjemahin ke bahasa Inggris yang natural:\\n\\n{clipboard}",
        "Rapihin tulisan | Rapihin tulisan ini biar enak dibaca, jangan ubah maksudnya:\\n\\n{clipboard}",
      ]
).join("\n");

function prompts(item: WidgetProps["item"]) {
  return str(item.cfg.prompts, DEFAULT_PROMPTS)
    .split("\n")
    .map((l) => l.split("|"))
    .filter((p) => p.length >= 2 && p[0].trim())
    .map(([label, ...rest]) => ({ label: label.trim(), text: rest.join("|").trim().replace(/\\n/g, "\n") }));
}

export function PromptsWidget({ item, size }: WidgetProps) {
  const chat = useStore(chatStore);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => initClipboard(), []);
  const list = prompts(item).slice(0, size === "l" ? 6 : 4);
  const run = async (text: string) => {
    let filled = text;
    if (text.includes("{clipboard}")) {
      const clip = (await api.clipboardRead().catch(() => null)) ?? clipStore.get()[0]?.text;
      if (!clip) {
        setNote(tr("Copy teksnya dulu", "Copy the text first"));
        window.setTimeout(() => setNote(null), 1800);
        return;
      }
      filled = text.split("{clipboard}").join(clip);
    }
    setTab("chat");
    void sendMessage(filled);
  };
  return (
    <div className="w-prompts">
      <WLabel icon="sparkle" right={note ?? (chat.running ? tr("Claude lagi jawab…", "Claude is replying…") : undefined)}>
        {tr("Prompt cepat", "Quick prompts")}
      </WLabel>
      <div className={`w-prompt-grid size-${size}`}>
        {list.map((p) => (
          <button key={p.label} className="w-chip" disabled={chat.running} onClick={() => void run(p.text)} title={p.text}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sesi Claude yang lagi jalan (versi mini)
// ---------------------------------------------------------------------------

export function SessionsWidget() {
  const { sessions, pending } = useStore(agentsStore);
  const active = sessions.filter((s) => s.status !== "ended");
  const working = active.filter((s) => s.status === "working").length;
  const top = active[0];
  const step = top?.steps.filter((s) => s.kind === "tool" || s.kind === "task").pop();
  return (
    <div className="w-sessions" role="button" onClick={() => setTab("agents")}>
      <WLabel icon="terminal" right={pending.length ? tr(`${pending.length} nunggu lu`, `${pending.length} waiting`) : working ? tr(`${working} kerja`, `${working} working`) : undefined}>
        {tr("Sesi Claude", "Claude sessions")}
      </WLabel>
      {top ? (
        <div className="w-session-row">
          <span className={`status-dot ${top.status}`} />
          <div className="w-session-text">
            <b className="ellipsis">{top.title || top.project}</b>
            <span className="muted ellipsis">
              {step ? `${step.kind === "tool" ? toolLabel(step.tool ?? "") + " " : ""}${step.detail}` : tr("Belum ada langkah", "No steps yet")}
            </span>
          </div>
          <Icon name="chevronDown" size={14} className="w-chev" />
        </div>
      ) : (
        <WState>{tr("Belum ada sesi. Chat atau terminal Claude yang lagi kerja muncul di sini.", "No sessions yet. Claude chats or terminals that are working show up here.")}</WState>
      )}
    </div>
  );
}
