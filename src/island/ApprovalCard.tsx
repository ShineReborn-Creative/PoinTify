import { useState } from "react";
import { Icon } from "../components/Icon";
import { Pip } from "../components/Pip";
import { useStore } from "../lib/store";
import { settingsStore } from "../state/settings";
import type { AgentQuestion, PendingRequest } from "../lib/api";
import { toolLabel } from "../lib/tools";
import { answerRequest } from "../state/agents";

/** Ukuran pulau buat kartu ini, biar area klik-nya pas. */
export function approvalSize(p: PendingRequest): { w: number; h: number } {
  if (p.kind === "permission") return { w: 500, h: p.detail.length > 70 ? 200 : 178 };
  const q = p.questions?.[0];
  const rows = Math.ceil((q?.options.length ?? 2) / 2);
  return { w: 520, h: 150 + rows * 46 };
}

/** Claude minta izin atau nanya sesuatu. Kartu ini nunggu sampai dijawab. */
export function ApprovalCard({ request, more }: { request: PendingRequest; more: number }) {
  return (
    <div className="approval fade-in" onClick={(e) => e.stopPropagation()}>
      {request.kind === "permission" ? (
        <PermissionBody request={request} more={more} />
      ) : (
        <QuestionBody request={request} more={more} />
      )}
    </div>
  );
}

function Header({ request, title, more }: { request: PendingRequest; title: string; more: number }) {
  const source = request.chatId ? "Chat PoinTify" : request.project;
  const petMode = useStore(settingsStore)?.petMode ?? false;
  return (
    <div className="approval-head">
      {!petMode && <Pip mood="notify" size={34} glow badge={more > 0 ? more + 1 : undefined} />}
      <div className="approval-title">
        <strong>{title}</strong>
        <span className="muted ellipsis">
          {source} · {toolLabel(request.tool)}
        </span>
      </div>
    </div>
  );
}

function PermissionBody({ request, more }: { request: PendingRequest; more: number }) {
  const respond = (action: "allow" | "always" | "deny" | "terminal") => void answerRequest(request.id, { action });

  const isCommand = request.tool === "Bash" || request.tool === "PowerShell";
  return (
    <>
      <Header request={request} title="Claude minta izin" more={more} />
      <div className={`approval-detail${isCommand ? " mono" : ""}`} title={request.target ?? request.detail}>
        {request.detail || toolLabel(request.tool)}
      </div>
      <div className="approval-actions">
        {!request.chatId && (
          <button className="btn ghost" onClick={() => respond("terminal")} title="Tampilkan pilihan di terminal">
            <Icon name="terminal" size={14} /> Di terminal
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onClick={() => respond("deny")}>
          Tolak
        </button>
        {request.alwaysLabel && (
          <button className="btn" onClick={() => respond("always")} title={`Izinin terus: ${request.alwaysLabel}`}>
            Selalu
          </button>
        )}
        <button className="btn btn-primary" onClick={() => respond("allow")}>
          Izinin
        </button>
      </div>
    </>
  );
}

function QuestionBody({ request, more }: { request: PendingRequest; more: number }) {
  const questions = request.questions ?? [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const q: AgentQuestion | undefined = questions[index];

  if (!q) return null;
  const chosen = answers[q.question] ?? [];
  const last = index === questions.length - 1;

  const finish = (next: Record<string, string[]>) => {
    if (!last) {
      setAnswers(next);
      setIndex(index + 1);
      return;
    }
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) flat[k] = v.join(", ");
    void answerRequest(request.id, { action: "answer", answers: flat });
  };

  const pick = (label: string) => {
    if (q.multiSelect) {
      const set = chosen.includes(label) ? chosen.filter((l) => l !== label) : [...chosen, label];
      setAnswers({ ...answers, [q.question]: set });
    } else {
      finish({ ...answers, [q.question]: [label] });
    }
  };

  return (
    <>
      <Header
        request={request}
        title={questions.length > 1 ? `Claude nanya (${index + 1}/${questions.length})` : "Claude nanya"}
        more={more}
      />
      <p className="approval-question">{q.question}</p>
      <div className="approval-options">
        {q.options.map((o) => (
          <button
            key={o.label}
            className={`option${chosen.includes(o.label) ? " on" : ""}`}
            onClick={() => pick(o.label)}
            title={o.description}
          >
            <span className="option-label ellipsis">{o.label}</span>
            {o.description && <span className="option-desc ellipsis">{o.description}</span>}
          </button>
        ))}
      </div>
      <div className="approval-actions">
        <button className="btn ghost" onClick={() => void answerRequest(request.id, { action: "terminal" })}>
          <Icon name="terminal" size={14} /> Jawab di terminal
        </button>
        <span className="spacer" />
        {q.multiSelect && (
          <button className="btn btn-primary" disabled={!chosen.length} onClick={() => finish(answers)}>
            {last ? "Kirim" : "Lanjut"}
          </button>
        )}
      </div>
    </>
  );
}
