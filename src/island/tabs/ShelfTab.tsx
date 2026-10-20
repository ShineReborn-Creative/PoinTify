import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { useRef } from "react";
import { fileIcon, Icon } from "../../components/Icon";
import { Pip, type PipMood } from "../../components/Pip";
import { api, type ShelfItem } from "../../lib/api";
import { fileSize } from "../../lib/format";
import { useStore } from "../../lib/store";
import { attach } from "../../state/chat";
import { guardBlur, islandStore, setTab } from "../../state/island";
import { shelfStore } from "../../state/shelf";

let dragIcon: string | null = null;

export function ShelfTab({ mood }: { mood: PipMood }) {
  const items = useStore(shelfStore);
  const island = useStore(islandStore);

  if (!items.length || island.fileOver) {
    return (
      <div className={`dropzone${island.fileOver ? " active" : ""}`}>
        <Pip mood={island.fileOver ? "listening" : mood} size={72} glow interactive />
        <div>
          <strong>{island.fileOver ? "Lepas aja, gue tangkep" : "Taruh file di sini"}</strong>
          <p className="muted">
            Drag file dari mana aja ke notch. File-nya tetap di tempat asal, rak cuma nyimpen jalan pintasnya.
            Nanti bisa di-drag keluar lagi atau ditanyain ke Claude.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shelf">
      <div className="shelf-head">
        <span className="muted">
          {items.length} file · drag keluar buat dipakai di app lain
        </span>
        <button className="btn ghost" onClick={() => void api.shelfClear()}>
          <Icon name="trash" size={14} /> Kosongin rak
        </button>
      </div>
      <div className="shelf-list">
        {items.map((item) => (
          <ShelfCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function ShelfCard({ item }: { item: ShelfItem }) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const beginDrag = async () => {
    try {
      dragIcon ??= await api.shelfDragIcon();
      guardBlur(15_000);
      await startDrag({ item: [item.path], icon: dragIcon });
    } catch (err) {
      console.error("drag gagal", err);
    } finally {
      guardBlur(300);
    }
  };

  return (
    <div
      className="shelf-card"
      title={item.path}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6) {
          start.current = null;
          void beginDrag();
        }
      }}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => void api.shelfOpen(item.id)}
    >
      <div className="shelf-icon">
        <Icon name={fileIcon(item.ext, item.isDir)} size={26} />
      </div>
      <span className="shelf-name">{item.name}</span>
      <span className="shelf-size muted">{item.isDir ? "Folder" : fileSize(item.size)}</span>
      <div className="shelf-actions">
        <button className="icon-btn" title="Buka" aria-label={`Buka ${item.name}`} onClick={() => void api.shelfOpen(item.id)}>
          <Icon name="open" size={14} />
        </button>
        <button className="icon-btn" title="Tampilkan di folder" aria-label="Tampilkan di folder" onClick={() => void api.shelfReveal(item.id)}>
          <Icon name="reveal" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Tanya Claude soal file ini"
          aria-label="Tanya Claude soal file ini"
          onClick={() => {
            attach([item.path]);
            setTab("chat");
          }}
        >
          <Icon name="chat" size={14} />
        </button>
        <button className="icon-btn" title="Hapus dari rak" aria-label="Hapus dari rak" onClick={() => void api.shelfRemove(item.id)}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
