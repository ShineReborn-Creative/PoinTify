import { Icon } from "../components/Icon";
import { Pip, type PipMood } from "../components/Pip";
import { useStore } from "../lib/store";
import { settingsStore } from "../state/settings";
import { dismissPeek, expand, type Peek } from "../state/island";

/** Kartu notifikasi kecil yang nyembul dari notch. */
export function PeekCard({ peek, mood }: { peek: Peek; mood: PipMood }) {
  // Pip lagi di desktop: dia yang terbang ke sebelah kartu ini, jadi nggak usah dobel.
  const petMode = useStore(settingsStore)?.petMode ?? false;
  return (
    <div
      className={`peek fade-in kind-${peek.kind}`}
      onClick={(e) => {
        e.stopPropagation();
        if (peek.openTab) expand(peek.openTab);
      }}
      role={peek.openTab ? "button" : undefined}
    >
      {!petMode && <Pip mood={mood} size={46} glow />}
      <div className="peek-text">
        <strong>{peek.title}</strong>
        {peek.body && <span>{peek.body}</span>}
      </div>
      {peek.actions?.length ? (
        <div className="peek-actions">
          {peek.actions.map((a) => (
            <button
              key={a.label}
              className={a.primary ? "btn btn-primary" : "btn"}
              onClick={(e) => {
                e.stopPropagation();
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          className="icon-btn peek-close"
          aria-label="Tutup"
          onClick={(e) => {
            e.stopPropagation();
            dismissPeek();
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
