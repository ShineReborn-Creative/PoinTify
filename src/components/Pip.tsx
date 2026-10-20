import { memo } from "react";

export type PipMood =
  | "idle"
  | "wave"
  | "thinking"
  | "working"
  | "notify"
  | "happy"
  | "sleep"
  | "listening"
  | "error"
  | "music";

export const MOOD_COLOR: Record<PipMood, string> = {
  idle: "#8B7CFF",
  wave: "#8B7CFF",
  thinking: "#4DA3FF",
  working: "#4DA3FF",
  notify: "#FFB340",
  happy: "#34C77B",
  sleep: "#5F5E66",
  listening: "#8B7CFF",
  error: "#FF5C5C",
  music: "#B98CFF",
};

type Props = {
  mood?: PipMood;
  /** Tinggi dalam px. */
  size?: number;
  /** Arah lirikan mata, -1..1. */
  look?: { x: number; y: number };
  /** Angka di badge titik (unsur "tify"). */
  badge?: string | number;
  glow?: boolean;
  className?: string;
};

/** Pip: huruf P yang hidup. Titik di sampingnya itu "point", badge-nya "tify". */
function PipImpl({ mood = "idle", size = 64, look, badge, glow = false, className }: Props) {
  const lx = Math.max(-1, Math.min(1, look?.x ?? 0)) * 3;
  const ly = Math.max(-1, Math.min(1, look?.y ?? 0)) * 2.5;
  const color = MOOD_COLOR[mood];
  return (
    <span
      className={`pip-wrap${glow ? " pip-glow" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size * (130 / 150), height: size, ["--pip-color" as string]: color }}
      aria-hidden="true"
    >
      <svg className={`pip mood-${mood}`} viewBox="0 0 130 150" width="100%" height="100%">
        <g className="pip-body">
          <path
            className="pip-shape"
            d="M30 45a15 15 0 0 1 15-15h17a34 34 0 0 1 0 68h-2v27a15 15 0 0 1-30 0z"
          />
          <g className="pip-eyes" style={{ transform: `translate(${lx}px, ${ly}px)` }}>
            <g className="pip-eyes-open">
              <ellipse className="pip-eye" cx="52" cy="62" rx="5" ry="6.5" />
              <ellipse className="pip-eye" cx="74" cy="62" rx="5" ry="6.5" />
              <circle className="pip-shine" cx="53.6" cy="59.6" r="1.6" />
              <circle className="pip-shine" cx="75.6" cy="59.6" r="1.6" />
            </g>
            <g className="pip-eyes-happy">
              <path d="M46 64q6-8 12 0" />
              <path d="M68 64q6-8 12 0" />
            </g>
            <g className="pip-eyes-sleep">
              <path d="M46 63q6 4 12 0" />
              <path d="M68 63q6 4 12 0" />
            </g>
            <g className="pip-eyes-error">
              <path d="M47 58l9 8M56 58l-9 8" />
              <path d="M69 58l9 8M78 58l-9 8" />
            </g>
          </g>
          <ellipse className="pip-cheek" cx="44" cy="74" rx="5" ry="3" />
          <ellipse className="pip-cheek" cx="82" cy="74" rx="5" ry="3" />
          <path className="pip-mouth" d="M58 78q5 5 10 0" />
        </g>
        <g className="pip-dot-orbit">
          <circle className="pip-dot" cx="104" cy="26" r="8.5" />
          {badge !== undefined && badge !== "" && (
            <text className="pip-badge" x="104" y="30" textAnchor="middle">
              {badge}
            </text>
          )}
        </g>
        <text className="pip-z" x="96" y="44">
          z
        </text>
      </svg>
    </span>
  );
}

export const Pip = memo(PipImpl);
