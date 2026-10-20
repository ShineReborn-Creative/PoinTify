import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import type { PipMood } from "../components/Pip";
import { useStore } from "../lib/store";
import { pin } from "../state/island";
import { num, str } from "./common";
import {
  ADD_TILE,
  addWidget,
  currentPack,
  editStore,
  moveWidget,
  openConfig,
  openGallery,
  removeWidget,
  resetLayout,
  saveLayout,
  setCfg,
  setDragId,
  setEditing,
  SIZE_LABEL,
  updateWidget,
  widgetStore,
  type WidgetItem,
  type WidgetSize,
} from "./layout";
import { GROUPS, widgetDef, WIDGETS, type Field, type WidgetDef } from "./registry";

const LONG_PRESS_MS = 550;

/** Beranda: kanvas widget 2 baris yang melebar ke kanan. */
export function WidgetCanvas({ mood }: { mood: PipMood }) {
  const layout = useStore(widgetStore);
  const edit = useStore(editStore);
  const { pos, cols } = useMemo(() => currentPack(layout, edit.editing), [layout, edit.editing]);
  const scroller = useRef<HTMLDivElement>(null);

  // Roda mouse naik-turun = geser kanan-kiri (kanvasnya cuma melebar).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      // Biarin area yang bisa di-scroll sendiri (lirik, to-do, clipboard) jalan normal.
      const inner = (e.target as HTMLElement).closest(".w-scroll");
      if (inner && inner.scrollHeight > inner.clientHeight) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const empty = layout.items.length === 0 && !edit.editing;

  return (
    <div className={`w-canvas-wrap${edit.editing ? " editing" : ""}`}>
      <div className="w-canvas" ref={scroller}>
        {empty ? (
          <div className="w-canvas-empty">
            <span className="muted">Beranda lu kosong.</span>
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              <Icon name="plus" size={14} /> Tambah widget
            </button>
          </div>
        ) : (
          <div className="w-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(140px, 1fr))` }}>
            {layout.items.map((item) => {
              const p = pos.get(item.id);
              if (!p) return null;
              return <Tile key={item.id} item={item} place={p} mood={mood} />;
            })}
            {edit.editing && pos.get(ADD_TILE) && (
              <button
                className="w-tile w-add-tile"
                style={{ gridColumn: `${pos.get(ADD_TILE)!.col + 1} / span 1`, gridRow: `${pos.get(ADD_TILE)!.row + 1} / span 1` }}
                onClick={() => openGallery(true)}
              >
                <Icon name="plus" size={20} />
                <span>Tambah widget</span>
              </button>
            )}
          </div>
        )}
      </div>
      {edit.gallery && <Gallery />}
      {edit.configId && <ConfigPanel id={edit.configId} />}
    </div>
  );
}

function Tile({ item, place, mood }: { item: WidgetItem; place: { col: number; row: number; w: number; h: number }; mood: PipMood }) {
  const edit = useStore(editStore);
  const def = widgetDef(item.type);
  const press = useRef<{ x: number; y: number; timer?: number; dragging: boolean; over: string | null } | null>(null);
  const style = { gridColumn: `${place.col + 1} / span ${place.w}`, gridRow: `${place.row + 1} / span ${place.h}` };

  // Tahan lama buat masuk mode Atur; di mode Atur, seret buat mindahin.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (edit.editing && target.closest(".w-tile-ctl")) return;
    // Ketik, tarik Pip, geser lagu: itu interaksi widget, bukan tahan-buat-atur.
    if (!edit.editing && target.closest("input, textarea, select, .pip-wrap, .progress")) return;
    const state = { x: e.clientX, y: e.clientY, dragging: false, over: null as string | null, timer: undefined as number | undefined };
    press.current = state;
    if (!edit.editing) {
      state.timer = window.setTimeout(() => {
        pin(true);
        setEditing(true);
        press.current = null;
      }, LONG_PRESS_MS);
    }
    const move = (ev: PointerEvent) => {
      const s = press.current;
      if (!s) return;
      const far = Math.hypot(ev.clientX - s.x, ev.clientY - s.y) > 6;
      if (!editStore.get().editing) {
        if (far) window.clearTimeout(s.timer);
        return;
      }
      if (!s.dragging && far) {
        s.dragging = true;
        setDragId(item.id);
      }
      if (!s.dragging) return;
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-wid]");
      const id = under?.dataset.wid ?? null;
      if (!id || id === item.id || id === s.over) return;
      s.over = id;
      const items = widgetStore.get().items;
      moveWidget(item.id, items.findIndex((i) => i.id === id), false);
    };
    const up = () => {
      const s = press.current;
      window.clearTimeout(s?.timer);
      if (s?.dragging) {
        setDragId(null);
        saveLayout();
      }
      press.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  if (!def) {
    return (
      <div className="w-tile w-unknown" style={style} data-wid={item.id}>
        <span className="muted">Widget "{item.type}" nggak dikenal</span>
        {edit.editing && (
          <button className="w-tile-ctl w-remove" aria-label="Hapus" onClick={() => removeWidget(item.id)}>
            <Icon name="minus" size={12} />
          </button>
        )}
      </div>
    );
  }

  const C = def.Component;
  const canResize = def.sizes.length > 1;
  const nextSize = () => def.sizes[(def.sizes.indexOf(item.size) + 1) % def.sizes.length];
  const configurable = !!def.fields?.length || !!def.Config || !!def.Live;
  const dragging = edit.dragId === item.id;

  return (
    <div
      className={`w-tile type-${item.type} size-${item.size}${edit.editing ? " jiggle" : ""}${dragging ? " lifted" : ""}`}
      style={style}
      data-wid={item.id}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        pin(true);
        if (!edit.editing) setEditing(true);
      }}
    >
      <div className="w-tile-body" inert={edit.editing || undefined}>
        <C item={item} size={item.size} mood={mood} />
      </div>
      {edit.editing && (
        <>
          <button className="w-tile-ctl w-remove" aria-label={`Hapus ${def.name}`} title="Hapus" onClick={() => removeWidget(item.id)}>
            <Icon name="minus" size={12} />
          </button>
          <div className="w-tile-tools">
            {canResize && (
              <button
                className="w-tile-ctl"
                title={`Ukuran: ${SIZE_LABEL[item.size]} (klik buat ganti)`}
                aria-label="Ganti ukuran"
                onClick={() => updateWidget(item.id, { size: nextSize() })}
              >
                <Icon name="resize" size={12} />
                <span className="w-size-tag">{SIZE_LABEL[item.size]}</span>
              </button>
            )}
            {configurable && (
              <button className="w-tile-ctl" title="Pengaturan widget" aria-label="Pengaturan widget" onClick={() => openConfig(item.id)}>
                <Icon name="gear" size={12} />
              </button>
            )}
          </div>
          {item.live && def.Live && <span className="w-live-tag">Live</span>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Galeri widget
// ---------------------------------------------------------------------------

function Gallery() {
  const layout = useStore(widgetStore);
  const [group, setGroup] = useState<(typeof GROUPS)[number] | "Semua">("Semua");
  const list = WIDGETS.filter((d) => group === "Semua" || d.group === group);
  const has = (d: WidgetDef) => layout.items.some((i) => i.type === d.type);

  const add = (d: WidgetDef) => {
    addWidget(d.type, d.defaultSize, { ...(d.defaultCfg ?? {}) }, d.Live ? true : undefined);
    openGallery(false);
    // Geser ke ujung kanan biar widget barunya keliatan.
    window.setTimeout(() => {
      const el = document.querySelector(".w-canvas");
      el?.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    }, 60);
  };

  return (
    <div className="w-overlay fade-in" role="dialog" aria-label="Tambah widget">
      <div className="w-overlay-head">
        <strong>Tambah widget</strong>
        <div className="w-groups">
          {(["Semua", ...GROUPS] as const).map((g) => (
            <button key={g} className={`w-group${group === g ? " active" : ""}`} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
        <button className="icon-btn" aria-label="Tutup" onClick={() => openGallery(false)}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="w-gallery w-scroll">
        {list.map((d) => {
          const taken = !!d.single && has(d);
          return (
            <button key={d.type} className="w-gal-item" disabled={taken} onClick={() => add(d)} title={taken ? "Udah kepasang" : d.desc}>
              <span className="w-gal-icon">
                <Icon name={d.icon} size={17} />
              </span>
              <span className="w-gal-text">
                <b>
                  {d.name}
                  {d.Live && <span className="w-live-mini">Live</span>}
                </b>
                <span className="muted">{taken ? "Udah kepasang" : d.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pengaturan satu widget
// ---------------------------------------------------------------------------

/** ISO → nilai buat <input type="datetime-local"> (waktu lokal). */
function toLocalInput(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function FieldInput({ item, field }: { item: WidgetItem; field: Field }) {
  const v = item.cfg[field.key];
  const set = (value: unknown) => setCfg(item.id, { [field.key]: value });
  switch (field.kind) {
    case "toggle":
      return (
        <button className={`w-switch${v === true ? " on" : ""}`} role="switch" aria-checked={v === true} onClick={() => set(v !== true)}>
          <i />
        </button>
      );
    case "select":
      return (
        <select className="w-input" value={str(v, field.options[0]?.[0] ?? "")} onChange={(e) => set(e.target.value)}>
          {field.options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      );
    case "number":
      return (
        <input
          className="w-input"
          type="number"
          min={field.min}
          max={field.max}
          value={v === undefined ? "" : num(v, 0)}
          onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "datetime":
      return (
        <input
          className="w-input"
          type="datetime-local"
          value={toLocalInput(str(v))}
          onChange={(e) => {
            const t = Date.parse(e.target.value);
            set(Number.isFinite(t) ? new Date(t).toISOString() : "");
          }}
        />
      );
    case "textarea":
      return <DraftText multiline value={str(v)} placeholder={field.placeholder} onSave={set} />;
    default:
      return <DraftText value={str(v)} placeholder={field.placeholder} onSave={set} />;
  }
}

/** Teks disimpen pas berhenti ngetik / pindah kolom, biar nggak nembak API tiap huruf. */
function DraftText({ value, placeholder, multiline, onSave }: { value: string; placeholder?: string; multiline?: boolean; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setText(value), [value]);
  const change = (t: string) => {
    setText(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSave(t), 700);
  };
  const flush = () => {
    window.clearTimeout(timer.current);
    if (text !== value) onSave(text);
  };
  return multiline ? (
    <textarea className="w-input w-textarea" value={text} placeholder={placeholder} onChange={(e) => change(e.target.value)} onBlur={flush} rows={4} />
  ) : (
    <input className="w-input" value={text} placeholder={placeholder} onChange={(e) => change(e.target.value)} onBlur={flush} onKeyDown={(e) => e.key === "Enter" && flush()} />
  );
}

function ConfigPanel({ id }: { id: string }) {
  const layout = useStore(widgetStore);
  const item = layout.items.find((i) => i.id === id);
  const def = item ? widgetDef(item.type) : undefined;
  if (!item || !def) return null;
  const Extra = def.Config;
  return (
    <div className="w-overlay fade-in" role="dialog" aria-label={`Pengaturan ${def.name}`}>
      <div className="w-overlay-head">
        <span className="w-gal-icon">
          <Icon name={def.icon} size={15} />
        </span>
        <strong>{def.name}</strong>
        <span className="muted ellipsis w-overlay-desc">{def.desc}</span>
        <button className="btn btn-primary" onClick={() => openConfig(null)}>
          Selesai
        </button>
      </div>
      <div className="w-config w-scroll">
        {def.sizes.length > 1 && (
          <label className="w-field">
            <span>Ukuran</span>
            <div className="w-seg">
              {def.sizes.map((s: WidgetSize) => (
                <button key={s} className={item.size === s ? "active" : ""} onClick={() => updateWidget(item.id, { size: s })}>
                  {SIZE_LABEL[s]}
                </button>
              ))}
            </div>
          </label>
        )}
        {def.fields?.map((f) => (
          <label className={`w-field${f.kind === "textarea" ? " wide" : ""}`} key={f.key}>
            <span>{f.label}</span>
            <FieldInput item={item} field={f} />
            {f.hint && <small className="muted">{f.hint}</small>}
          </label>
        ))}
        {def.Live && (
          <label className="w-field">
            <span>Live di notch kecil</span>
            <button
              className={`w-switch${item.live ? " on" : ""}`}
              role="switch"
              aria-checked={!!item.live}
              onClick={() => updateWidget(item.id, { live: !item.live })}
            >
              <i />
            </button>
            {def.liveHint && <small className="muted">{def.liveHint}</small>}
          </label>
        )}
        {Extra && (
          <div className="w-field wide">
            <span>Isi</span>
            <Extra item={item} />
          </div>
        )}
        <div className="w-field wide w-config-foot">
          <button className="btn danger" onClick={() => removeWidget(item.id)}>
            <Icon name="trash" size={13} /> Hapus widget
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tombol di tab bar: masuk/keluar mode Atur. */
export function EditToggle() {
  const edit = useStore(editStore);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);
  if (!edit.editing) {
    return (
      <button
        className="icon-btn"
        aria-label="Atur widget"
        title="Atur widget (atau tahan lama widget mana aja)"
        onClick={() => {
          pin(true);
          setEditing(true);
        }}
      >
        <Icon name="grid" size={16} />
      </button>
    );
  }
  return (
    <>
      <button
        className={`btn small${confirmReset ? " danger" : " ghost"}`}
        title="Balikin susunan awal (isi to-do & catatan ikut kehapus)"
        onClick={() => {
          if (!confirmReset) return setConfirmReset(true);
          setConfirmReset(false);
          resetLayout();
        }}
      >
        {confirmReset ? "Yakin reset?" : "Reset"}
      </button>
      <button className="btn btn-primary small" onClick={() => setEditing(false)}>
        Selesai
      </button>
    </>
  );
}
