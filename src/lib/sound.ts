import { quietStore } from "../state/quiet";
import { settingsStore } from "../state/settings";

/**
 * Suara PoinTify dibikin langsung pakai Web Audio (nggak ada file audio),
 * jadi semuanya orisinal dan ringan.
 */
type SoundName = "open" | "close" | "chime" | "drop" | "done" | "error" | "tick";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  duration: number,
  opts: { type?: OscillatorType; gain?: number; slideTo?: number } = {},
) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, start);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + duration);
  const peak = opts.gain ?? 0.12;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function play(name: SoundName) {
  if (!settingsStore.get()?.sounds) return;
  // Mode tenang: cuma bunyi buat kartu izin Claude (chime) yang tetap jalan.
  if (quietStore.get() && name !== "chime") return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  switch (name) {
    case "open":
      tone(ac, 520, t, 0.09, { gain: 0.05, slideTo: 760 });
      break;
    case "close":
      tone(ac, 640, t, 0.08, { gain: 0.04, slideTo: 420 });
      break;
    case "tick":
      tone(ac, 1200, t, 0.03, { gain: 0.03, type: "triangle" });
      break;
    case "drop":
      // Tetesan air: nada turun cepat lalu naik sedikit.
      tone(ac, 1400, t, 0.12, { gain: 0.08, slideTo: 520 });
      tone(ac, 900, t + 0.13, 0.1, { gain: 0.05, slideTo: 1100 });
      break;
    case "chime":
      tone(ac, 660, t, 0.35, { gain: 0.07 });
      tone(ac, 880, t + 0.12, 0.45, { gain: 0.06 });
      break;
    case "done":
      tone(ac, 523, t, 0.18, { gain: 0.07, type: "triangle" });
      tone(ac, 659, t + 0.1, 0.18, { gain: 0.07, type: "triangle" });
      tone(ac, 784, t + 0.2, 0.4, { gain: 0.07, type: "triangle" });
      break;
    case "error":
      tone(ac, 300, t, 0.18, { gain: 0.06, type: "square", slideTo: 220 });
      break;
  }
}
