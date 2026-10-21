import { locale, tr } from "../i18n";
import { useEffect } from "react";
import { num, str, WLabel, WState, type WidgetProps } from "./common";
import { pick, setLive, useJson } from "./data";

function format(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString(locale(), { maximumFractionDigits: 2 });
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "Ya" : "Nggak";
  if (v == null) return "–";
  return JSON.stringify(v).slice(0, 40);
}

function useCustom(item: WidgetProps["item"]) {
  const url = str(item.cfg.url).trim();
  const every = Math.max(10, num(item.cfg.every, 60)) * 1000;
  const res = useJson<unknown>(/^https?:\/\//.test(url) ? url : null, every);
  const value = res.data === undefined ? undefined : pick(res.data, str(item.cfg.path));
  const text = value === undefined ? "" : `${str(item.cfg.prefix)}${format(value)}${str(item.cfg.suffix)}`;
  return { url, res, text };
}

/** Widget kustom: ambil satu angka/teks dari API JSON mana aja. */
export function CustomWidget({ item, size }: WidgetProps) {
  const { url, res, text } = useCustom(item);
  const label = str(item.cfg.label) || tr("Widget kustom", "Custom widget");
  return (
    <div className={`w-custom size-${size}`}>
      <WLabel icon="plug">{label}</WLabel>
      {!url ? (
        <span className="muted w-hint">{tr("Isi alamat API JSON dan jalur nilainya lewat gerigi di mode Atur.", "Set the JSON API URL and value path with the gear in Arrange mode.")}</span>
      ) : res.data !== undefined ? (
        <strong className="w-big ellipsis" title={text}>
          {text}
        </strong>
      ) : (
        <WState error={!!res.error}>{res.error ?? tr("Ngambil data…", "Fetching data…")}</WState>
      )}
      {size !== "s" && url && <span className="muted ellipsis w-custom-src">{url.replace(/^https?:\/\//, "")}</span>}
    </div>
  );
}

export function CustomLive({ item }: WidgetProps) {
  const { text } = useCustom(item);
  const label = str(item.cfg.label) || "Kustom";
  useEffect(() => setLive(item.id, text ? { priority: 1, icon: "plug", label, value: text } : null), [item.id, text, label]);
  useEffect(() => () => setLive(item.id, null), [item.id]);
  return null;
}
