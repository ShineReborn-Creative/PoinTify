import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Pip, type PipMood } from "../../components/Pip";
import { api, type AgentSession, type AgentStep, type HooksStatus } from "../../lib/api";
import { useStore } from "../../lib/store";
import { toolLabel } from "../../lib/tools";
import { agentsStore } from "../../state/agents";
import { tr } from "../../i18n";

const STATUS_LABEL = (): Record<AgentSession["status"], string> => ({
  working: tr("lagi kerja", "working"),
  waiting: tr("nunggu lu", "waiting for you"),
  idle: tr("selesai", "done"),
  ended: tr("ditutup", "closed"),
});

/** Buka pengaturan langsung di bagian Claude. */
export function openClaudeSettings() {
  try {
    localStorage.setItem("pointify.settings.section", "claude");
  } catch {
    // Nggak apa-apa, jendela pengaturan kebuka di bagian pertama.
  }
  void api.settingsOpen();
}

export function AgentsTab({ mood }: { mood: PipMood }) {
  const { sessions } = useStore(agentsStore);
  const [selected, setSelected] = useState<string | null>(null);
  const current = sessions.find((s) => s.id === selected) ?? sessions[0];

  if (!current) return <EmptySessions mood={mood} />;

  return (
    <div className="agents">
      {sessions.length > 1 && (
        <div className="session-pills" role="tablist">
          {sessions.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === current.id}
              className={`session-pill${s.id === current.id ? " active" : ""}`}
              onClick={() => setSelected(s.id)}
            >
              <span className={`status-dot ${s.status}`} />
              <span className="ellipsis">{s.title || s.project}</span>
            </button>
          ))}
        </div>
      )}
      <SessionView session={current} />
    </div>
  );
}

function SessionView({ session }: { session: AgentSession }) {
  const listRef = useRef<HTMLDivElement>(null);
  const last = session.steps[session.steps.length - 1];

  // Ikutin langkah terbaru, kayak terminal.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.id, session.steps.length, last?.ok, session.lastMessage]);

  const totals = session.steps.reduce(
    (t, s) => ({ added: t.added + (s.added ?? 0), removed: t.removed + (s.removed ?? 0) }),
    { added: 0, removed: 0 },
  );

  return (
    <div className="session">
      <div className="session-head">
        <div className="session-title">
          <strong className="ellipsis">{session.title || session.project}</strong>
          <span className="muted ellipsis" title={session.cwd || undefined}>
            {session.source === "chat" ? `Chat Claude · ${session.project}` : session.cwd}
          </span>
        </div>
        {(totals.added > 0 || totals.removed > 0) && (
          <span className="diff-total tabular">
            <span className="plus">+{totals.added}</span> <span className="minus">−{totals.removed}</span>
          </span>
        )}
        <span className={`status-chip ${session.status}`}>{STATUS_LABEL()[session.status]}</span>
        {session.status === "ended" && (
          <button
            className="icon-btn"
            aria-label={tr("Hapus dari daftar", "Remove from list")}
            title={tr("Hapus dari daftar", "Remove from list")}
            onClick={() => void api.agentsDismiss(session.id)}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="steps" ref={listRef}>
        {session.steps.length === 0 && <p className="muted steps-empty">{tr("Sesi kebuka. Nunggu perintah pertama…", "Session started. Waiting for the first prompt…")}</p>}
        {session.steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
        {session.lastMessage && session.status === "working" && session.source === "chat" && (
          <p className="step-note muted">{session.lastMessage}</p>
        )}
        {session.lastMessage && session.status !== "working" && (
          <div className="step-final">
            <Pip mood="happy" size={18} still />
            <span>{session.lastMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  if (step.kind === "todo") {
    return (
      <div className="step todo">
        <span className="todo-dot" aria-hidden="true" />
        <span className="step-detail ellipsis">{step.detail}</span>
      </div>
    );
  }
  if (step.kind === "task") {
    return (
      <div className={`step tool${step.ok === false ? " failed" : ""}`}>
        {step.ok === null ? (
          <span className="spinner" aria-label={tr("lagi dikerjain", "in progress")} />
        ) : (
          <Icon name={step.ok ? "check" : "close"} size={12} />
        )}
        <span className={`ellipsis${step.ok === null ? " step-name" : " step-detail"}`}>{step.detail}</span>
      </div>
    );
  }
  if (step.kind === "prompt") {
    return (
      <div className="step prompt">
        <span className="ellipsis-2">{step.detail}</span>
      </div>
    );
  }
  return (
    <div className={`step tool${step.ok === false ? " failed" : ""}`} title={step.target ?? step.detail}>
      {step.ok === null ? (
        <span className="spinner" aria-label={tr("lagi jalan", "running")} />
      ) : (
        <Icon name={step.ok ? "check" : "close"} size={12} />
      )}
      <span className="step-name">{toolLabel(step.tool ?? "")}</span>
      <span className={`step-detail ellipsis${step.tool === "Bash" || step.tool === "PowerShell" ? " mono" : ""}`}>
        {step.detail}
      </span>
      {(step.added != null || step.removed != null) && (
        <span className="step-diff tabular">
          {step.added != null && <span className="plus">+{step.added}</span>}
          {step.removed != null && <span className="minus">−{step.removed}</span>}
        </span>
      )}
    </div>
  );
}

function EmptySessions({ mood }: { mood: PipMood }) {
  const [hooks, setHooks] = useState<HooksStatus | null>(null);
  useEffect(() => {
    void api.hooksStatus().then(setHooks).catch(() => setHooks(null));
  }, []);
  const installed = hooks?.state === "installed";
  return (
    <div className="agents-empty">
      <Pip mood={mood === "sleep" ? "idle" : mood} size={64} glow interactive />
      <div>
        <strong>{installed ? tr("Belum ada sesi yang jalan", "No sessions running yet") : tr("Pantau Claude Code dari sini", "Monitor Claude Code from here")}</strong>
        <p className="muted">
          {installed
            ? tr(
                "Kerjaan Claude muncul di sini: dari chat di app Claude (selama chat-nya nyambung ke PC ini) dan dari claude di terminal. Kalau Claude minta izin, lu bisa jawab langsung dari notch.",
                "Claude's work shows up here: from chats in the Claude app (while they're linked to this PC) and from claude in your terminal. When Claude asks for permission, answer right from the notch.",
              )
            : tr(
                "Lihat Claude Code di terminal lagi ngapain, izinin perintahnya, dan jawab pertanyaannya tanpa bolak-balik ke terminal.",
                "See what Claude Code is doing in your terminal, approve its commands, and answer its questions without switching windows.",
              )}
        </p>
        {hooks && !installed && (
          <button className="btn btn-primary" onClick={openClaudeSettings}>
            {hooks.state === "outdated" ? tr("Pasang ulang di Pengaturan", "Reinstall in Settings") : tr("Pasang di Pengaturan", "Install in Settings")}
          </button>
        )}
      </div>
    </div>
  );
}
