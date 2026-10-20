import { Pip, type PipMood } from "../components/Pip";
import { Ring } from "../components/Ring";
import { mmss } from "../lib/format";
import { useNow } from "../lib/hooks";
import { useStore } from "../lib/store";
import { chatStore } from "../state/chat";
import { mediaStore } from "../state/media";
import { phaseDuration, remaining, timerStore } from "../state/timer";

type Props = { mood: PipMood; activity: "claude" | "timer" | "music" | null };

/** Notch dalam keadaan kecil: Pip di kiri, kegiatan yang lagi jalan di kanan. */
export function CompactBar({ mood, activity }: Props) {
  return (
    <div className="compact fade-in">
      <Pip mood={mood} size={24} />
      <div className="compact-right">
        {activity === "claude" && <ClaudeActivity />}
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
