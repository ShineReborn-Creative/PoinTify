import { Pip, type PipMood } from "../components/Pip";
import { compactPip } from "../state/islandDrag";
import { dragPipOut } from "../state/pet";
import { settingsStore } from "../state/settings";
import { Ring } from "../components/Ring";
import { mmss } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useStore } from "../lib/store";
import { toolLabel } from "../lib/tools";
import { activeSession, agentsStore } from "../state/agents";
import { chatStore } from "../state/chat";
import { mediaStore } from "../state/media";
import { phaseDuration, remaining, timerStore } from "../state/timer";

export type Activity = "claude" | "agent" | "timer" | "music" | null;

type Props = { mood: PipMood; activity: Activity };

/** Notch dalam keadaan kecil: Pip di kiri, kegiatan yang lagi jalan di kanan. */
export function CompactBar({ mood, activity }: Props) {
  return (
    <div className="compact fade-in">
      <CompactPip mood={mood} />
      <div className="compact-right">
        {activity === "claude" && <ClaudeActivity />}
        {activity === "agent" && <AgentActivity />}
        {activity === "timer" && <TimerActivity />}
        {activity === "music" && <MusicActivity />}
      </div>
    </div>
  );
}

function ClaudeActivity() {
  const chat = useStore(chatStore);
  const tool = [...chat.live].reverse().find((s) => s.kind === "tool");
  return (
    <span className="compact-label">
      {chat.lastActivity === "working" && tool?.kind === "tool" ? `Claude: ${tool.name}` : "Claude lagi mikir"}
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Pip di notch kecil. Bisa diseret keluar jadi Pip desktop; kalau lagi di desktop, tempatnya kosong. */
function CompactPip({ mood }: { mood: PipMood }) {
  const settings = useStore(settingsStore);
  if (settings?.petMode) return <span className="compact-pip-away" title="Pip lagi di desktop" />;
  return <Pip mood={mood} size={24} onDragOut={dragPipOut} onEngine={(e) => (compactPip.engine = e)} />;
}

/** Sesi Claude Code di terminal: nama project + langkah terakhir. */
function AgentActivity() {
  const agents = useStore(agentsStore);
  const s = activeSession(agents);
  if (!s) return null;
  if (s.source === "chat") {
    const tasks = s.steps.filter((x) => x.kind === "task" || x.kind === "todo");
    const done = tasks.filter((x) => x.kind === "task" && x.ok !== null).length;
    const active = tasks.find((x) => x.kind === "task" && x.ok === null);
    return (
      <span className="compact-label">
        <span className="compact-project">Claude</span>
        <span className="ellipsis">{active?.detail ?? s.title ?? s.project}</span>
        {tasks.length > 0 && <span className="compact-count tabular">{`${done}/${tasks.length}`}</span>}
      </span>
    );
  }
  const step = [...s.steps].reverse().find((x) => x.kind === "tool");
  const what = step ? `${toolLabel(step.tool ?? "")} ${step.detail}`.trim() : "lagi mikir";
  return (
    <span className="compact-label" title={`${s.project}: ${what}`}>
      <span className="compact-project">{s.project}</span>
      <span className="ellipsis">{what}</span>
      {step && (step.added != null || step.removed != null) && (
        <span className="step-diff tabular">
          {step.added != null && <span className="plus">+{step.added}</span>}
          {step.removed != null && <span className="minus">−{step.removed}</span>}
        </span>
      )}
    </span>
  );
}

function TimerActivity() {
  const timer = useStore(timerStore);
  const now = useNow(1000);
  const left = remaining(timer, now);
  const total = phaseDuration(timer.phase);
  return (
    <span className="compact-timer">
      <Ring
        size={18}
        stroke={2.5}
        progress={1 - left / total}
        color={timer.phase === "focus" ? "var(--accent)" : "var(--green)"}
      />
      <span className="tabular">{mmss(left)}</span>
    </span>
  );
}

function MusicActivity() {
  const media = useStore(mediaStore);
  if (!media) return null;
  return (
    <span className="compact-music">
      {media.thumbnail && <img src={media.thumbnail} alt="" />}
      <span className="bars playing" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
