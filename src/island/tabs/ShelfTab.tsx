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
import { tr } from "../../i18n";

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
      title: directory ? tr("Pilih folder buat ditaruh di rak", "Choose folders for the shelf") : tr("Pilih file buat ditaruh di rak", "Choose files for the shelf"),
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
        <Icon name="file" size={14} /> {compact ? tr("File", "Files") : tr("Pilih file", "Choose files")}
      </button>
      <button className={compact ? "btn ghost" : "btn"} onClick={() => void pickToShelf(true)}>
        <Icon name="folder" size={14} /> {compact ? tr("Folder", "Folders") : tr("Pilih folder", "Choose folders")}
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
          <strong>{island.fileOver ? tr("Lepas aja, gue tangkep", "Let go, I'll catch it") : tr("Taruh file di sini", "Drop files here")}</strong>
          {elevated ? (
            <p className="shelf-warn">
              {tr(
                "PoinTify lagi jalan sebagai Administrator, jadi Windows ngeblok file yang diseret dari File Explorer. Tutup VS Code atau terminal-nya, buka lagi biasa (bukan Run as administrator), terus jalanin ulang. Sementara itu pakai tombol di bawah.",
                "PoinTify is running as Administrator, so Windows blocks files dragged from File Explorer. Close VS Code or the terminal, reopen it normally (not Run as administrator), and start again. Meanwhile, use the buttons below.",
              )}
            </p>
          ) : (
            <p className="muted">
              {tr(
                "Drag file atau folder dari mana aja ke notch, atau pilih lewat tombol di bawah. File-nya tetap di tempat asal, rak cuma nyimpen jalan pintasnya.",
                "Drag files or folders from anywhere onto the notch, or pick them with the buttons below. Files stay where they are; the shelf only keeps shortcuts.",
              )}
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
          {tr(`${items.length} file · drag keluar buat dipakai di app lain`, `${items.length} ${items.length === 1 ? "file" : "files"} · drag out to use in other apps`)}
        </span>
        <div className="shelf-head-actions">
          <PickButtons compact />
          <button className="btn ghost" onClick={() => void api.shelfClear()}>
            <Icon name="trash" size={14} /> {tr("Kosongin", "Clear")}
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
        <button className="icon-btn" title={tr("Buka", "Open")} aria-label={`${tr("Buka", "Open")} ${item.name}`} onClick={() => void api.shelfOpen(item.id)}>
          <Icon name="open" size={14} />
        </button>
        <button className="icon-btn" title={tr("Tampilkan di folder", "Show in folder")} aria-label={tr("Tampilkan di folder", "Show in folder")} onClick={() => void api.shelfReveal(item.id)}>
          <Icon name="reveal" size={14} />
        </button>
        <button
          className="icon-btn"
          title={tr("Tanya Claude soal file ini", "Ask Claude about this file")}
          aria-label={tr("Tanya Claude soal file ini", "Ask Claude about this file")}
          onClick={() => {
            attach([item.path]);
            setTab("chat");
          }}
        >
          <Icon name="chat" size={14} />
        </button>
        <button className="icon-btn" title={tr("Hapus dari rak", "Remove from shelf")} aria-label={tr("Hapus dari rak", "Remove from shelf")} onClick={() => void api.shelfRemove(item.id)}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
