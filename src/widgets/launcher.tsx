import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { api } from "../lib/api";
import { uid } from "../lib/format";
import { guardBlur, pin } from "../state/island";
import { WState, type WidgetProps } from "./common";
import { setCfg, type WidgetItem } from "./layout";

export type Shortcut = { id: string; label: string; target: string };

export function shortcuts(item: WidgetItem): Shortcut[] {
  return Array.isArray(item.cfg.items) ? (item.cfg.items as Shortcut[]) : [];
}

function kind(target: string): IconName {
  if (/^https?:\/\//.test(target)) return "link";
  if (/\.(exe|lnk|bat|cmd|appref-ms)$/i.test(target)) return "rocket";
  if (/\.[a-z0-9]{1,5}$/i.test(target)) return "file";
  return "folder";
}

export function LauncherWidget({ item, size }: WidgetProps) {
  const list = shortcuts(item).slice(0, size === "s" ? 4 : size === "w" ? 4 : 8);
  const [err, setErr] = useState<string | null>(null);
  if (!list.length) return <WState>Tambahin app, folder, atau link lewat gerigi di mode Atur.</WState>;
  return (
    <div className={`w-launch size-${size}`}>
      {list.map((s) => (
        <button
          key={s.id}
          className="w-launch-btn"
          title={err ?? s.target}
          onClick={() => void api.launchOpen(s.target).catch((e) => setErr(String(e)))}
        >
          <Icon name={kind(s.target)} size={size === "s" ? 16 : 18} />
          {size !== "s" && <span className="ellipsis">{s.label}</span>}
        </button>
      ))}
    </div>
  );
}

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.(exe|lnk)$/i, "") ?? path;

/** Editor isi peluncur (dipakai di panel pengaturan widget). */
export function LauncherConfig({ item }: { item: WidgetItem }) {
  const list = shortcuts(item);
  const [url, setUrl] = useState("");
  const save = (items: Shortcut[]) => setCfg(item.id, { items });
  const pick = async (directory: boolean) => {
    guardBlur(120_000);
    pin(true);
    try {
      const picked = await openDialog({ multiple: true, directory, title: directory ? "Pilih folder" : "Pilih app atau file" });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length) save([...list, ...paths.map((p) => ({ id: uid(), label: nameOf(p), target: p }))]);
    } finally {
      guardBlur(400);
    }
  };
  return (
    <div className="wc-launcher">
      {list.map((s) => (
        <div className="wc-launch-row" key={s.id}>
          <Icon name={kind(s.target)} size={14} />
          <input
            className="w-input"
            value={s.label}
            onChange={(e) => save(list.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
          />
          <span className="muted ellipsis wc-target" title={s.target}>
            {s.target}
          </span>
          <button className="icon-btn" aria-label={`Hapus ${s.label}`} onClick={() => save(list.filter((x) => x.id !== s.id))}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
      <div className="wc-launch-add">
        <button className="btn" onClick={() => void pick(false)}>
          <Icon name="rocket" size={13} /> App / file
        </button>
        <button className="btn" onClick={() => void pick(true)}>
          <Icon name="folder" size={13} /> Folder
        </button>
        <input
          className="w-input"
          value={url}
          placeholder="https://… lalu Enter"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            const u = url.trim();
            if (e.key !== "Enter" || !/^https?:\/\//.test(u)) return;
            let label = u;
            try {
              label = new URL(u).hostname.replace(/^www\./, "");
            } catch {
              // pakai alamat apa adanya
            }
            save([...list, { id: uid(), label, target: u }]);
            setUrl("");
          }}
        />
      </div>
    </div>
  );
}
