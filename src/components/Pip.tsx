import { memo, useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../lib/hooks";
import { MOOD_COLOR, PipEngine, type PipMood } from "../pip/engine";

export { MOOD_COLOR, type PipMood };

type Props = {
  mood?: PipMood;
  /** Tinggi huruf P dalam px. */
  size?: number;
  /** Angka di badge titik (unsur "tify"). */
  badge?: string | number;
  glow?: boolean;
  /** Bisa diklik dan di-hover (kesel, pusing, dadah, jatuh cinta). */
  interactive?: boolean;
  /** Nggak gerak sendiri. Buat Pip kecil yang jumlahnya banyak. */
  still?: boolean;
  className?: string;
};

// viewBox mesin: x -20..150, y -32..158. Huruf P-nya ada di 0..130 x 0..150,
// jadi SVG dibikin lebih besar dari kotaknya dan sisanya dibiarkan meluber
// (buat partikel dan titik yang terbang), tanpa ngubah tata letak.
const VB = { x: -20, y: -32, w: 170, h: 190, pw: 130, ph: 150 };

/** Pip: huruf P yang hidup. Titik di sampingnya itu "point", badge-nya "tify". */
function PipImpl({
  mood = "idle",
  size = 64,
  badge,
  glow = false,
  interactive = false,
  still = false,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<PipEngine | null>(null);
  const reduced = usePrefersReducedMotion();
  const isStill = still || reduced;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const engine = new PipEngine(svg, { still: isStill });
    engine.setMood(mood);
    engine.setBadge(badge);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Mood & badge diatur effect di bawah; mesin cuma dibikin ulang kalau mode diamnya berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStill]);

  useEffect(() => {
    engineRef.current?.setMood(mood);
  }, [mood]);

  useEffect(() => {
    engineRef.current?.setBadge(badge === "" ? undefined : badge);
  }, [badge]);

  const unit = size / VB.ph;
  return (
    <span
      className={`pip-wrap${glow ? " pip-glow" : ""}${interactive ? " pip-interactive" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: VB.pw * unit, height: size, ["--pip-color" as string]: MOOD_COLOR[mood] }}
      aria-hidden="true"
      onPointerEnter={interactive ? () => engineRef.current?.hover(true) : undefined}
      onPointerLeave={interactive ? () => engineRef.current?.hover(false) : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              engineRef.current?.tap();
            }
          : undefined
      }
    >
      <svg
        ref={svgRef}
        className="pip"
        style={{
          left: VB.x * unit,
          top: VB.y * unit,
          width: VB.w * unit,
          height: VB.h * unit,
        }}
      />
    </span>
  );
}

export const Pip = memo(PipImpl);
