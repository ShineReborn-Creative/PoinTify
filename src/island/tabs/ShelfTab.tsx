import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { FileIcon } from "../../components/FileIcon";
import { Icon } from "../../components/Icon";
import { Pip, type PipMood } from "../../components/Pip";
import { api, type ShelfItem } from "../../lib/api";
import { fileSize } from "../../lib/format";
import { useStore } from "../../lib/store";
import { attach } from "../../state/chat";
import { guardBlur, islandStore, pin, setTab } from "../../state/island";
import { addToShelf, shelfStore } from "../../state/shelf";

let dragIcon: string | null = null;
/** Dicek sekali aja: status Administrator nggak berubah selama app jalan. */
let elevatedCache: boolean | null = null;

function useElevated() {
  const [elevated, setElevated] = useState(elevatedCache ?? false);
  useEffect(() => {
    if (elevatedCache !== null) return;
    void api
      .shelfDiagnose()
      .then((d) => {
        elevatedCache = !!d?.elevated;
        setElevated(elevatedCache);
      })
      .catch(() => {});
  }, []);
  return elevated;
}

/** Cara lain naruh file: pilih lewat jendela Windows. */
async function pickToShelf(directory: boolean) {
  guardBlur(120_000);
  pin(true);
  try {
    const picked = await openDialog({
      multiple: true,
      directory,
      title: directory ? "Pilih folder buat ditaruh di rak" : "Pilih file buat ditaruh di rak",
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length) await addToShelf(paths);
  } finally {
    guardBlur(400);
  }
}

function PickButtons({ compact }: { compact?: boolean }) {
  return (
    <div className="shelf-pick">
      <button className={compact ? "btn ghost" : "btn"} onClick={() => void pickToShelf(false)}>
        <Icon name="file" size={14} /> {compact ? "File" : "Pilih file"}
      </button>
      <button className={compact ? "btn ghost" : "btn"} onClick={() => void pickToShelf(true)}>
        <Icon name="folder" size={14} /> {compact ? "Folder" : "Pilih folder"}
      </button>
    </div>
  );
}

export function ShelfTab({ mood }: { mood: PipMood }) {
  const items = useStore(shelfStore);
  const island = useStore(islandStore);
  const elevated = useElevated();

  if (!items.length || island.fileOver) {
    return (
      <div className={`dropzone${island.fileOver ? " active" : ""}`}>
        <Pip mood={island.fileOver ? "listening" : mood} size={72} glow interactive />
        <div>
          <strong>{island.fileOver ? "Lepas aja, gue tangkep" : "Taruh file di sini"}</strong>
          {elevated ? (
            <p className="shelf-warn">
              PoinTify lagi jalan sebagai Administrator, jadi Windows ngeblok file yang diseret dari File Explorer.
              Tutup VS Code atau terminal-nya, buka lagi biasa (bukan Run as administrator), terus jalanin ulang.
              Sementara itu pakai tombol di bawah.
            </p>
          ) : (
            <p className="muted">
              Drag file atau folder dari mana aja ke notch, atau pilih lewat tombol di bawah. File-nya tetap di tempat
              asal, rak cuma nyimpen jalan pintasnya.
            </p>
          )}
          {!island.fileOver && <PickButtons />}
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
        <div className="shelf-head-actions">
          <PickButtons compact />
          <button className="btn ghost" onClick={() => void api.shelfClear()}>
            <Icon name="trash" size={14} /> Kosongin
          </button>
        </div>
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
        <FileIcon ext={item.ext} isDir={item.isDir} size={46} />
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
