import { Pip, type PipMood } from "../components/Pip";
import { tr } from "../i18n";
import { useStore } from "../lib/store";
import { settingsStore } from "../state/settings";
import { finishTour, nextStep, prevStep, tourSteps, tourStore } from "./tour";

/** Kartu tour perkenalan: Pip, penjelasan, titik progres, tombol lanjut. */
export function TourCard({ mood }: { mood: PipMood }) {
  const i = useStore(tourStore);
  const petMode = useStore(settingsStore)?.petMode ?? false;
  const steps = tourSteps();
  if (i === null || !steps[i]) return null;
  const step = steps[i];
  const actions = step.actions ?? [
    { label: tr("Lewati tour", "Skip tour"), run: () => finishTour() },
    { label: tr("Lanjut", "Next"), primary: true, run: () => nextStep() },
  ];
  return (
    <div className="tour fade-in" onClick={(e) => e.stopPropagation()}>
      {!petMode && <Pip mood={mood} size={56} glow />}
      <div className="tour-main">
        <div className="tour-text" key={i}>
          <strong>{step.title}</strong>
          <span>{step.body}</span>
        </div>
        <div className="tour-foot">
          <div className="tour-dots" aria-label={tr(`Langkah ${i + 1} dari ${steps.length}`, `Step ${i + 1} of ${steps.length}`)}>
            {steps.map((_, n) => (
              <i key={n} className={n === i ? "on" : n < i ? "done" : ""} />
            ))}
          </div>
          <div className="peek-actions">
            {i > 0 && !step.actions && (
              <button className="btn ghost" onClick={() => prevStep()}>
                {tr("Balik", "Back")}
              </button>
            )}
            {actions.map((a) => (
              <button key={a.label} className={a.primary ? "btn btn-primary" : "btn"} onClick={() => a.run()}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
