import { memo } from "react";

/**
 * Ikon file ala badge: lembar kertas berwarna sesuai ekstensi, gambar kecil
 * sesuai jenisnya, dan label ekstensi di bawah. Tiap ekstensi punya warna
 * sendiri (PNG beda sama JPG, XLSX beda sama CSV), jadi isi Rak gampang
 * dibedain sekilas.
 */

type Glyph = "sheet" | "doc" | "slides" | "pdf" | "image" | "vector" | "video" | "audio" | "zip" | "code" | "app" | "disc" | "design" | "text" | "font" | "data" | "file";

type Style = { color: string; glyph: Glyph; ink?: string };

const S = (color: string, glyph: Glyph, ink?: string): Style => ({ color, glyph, ink });

const STYLES: Record<string, Style> = {
  // Office & dokumen
  xlsx: S("#1D8F4E", "sheet"),
  xls: S("#217346", "sheet"),
  xlsm: S("#16693B", "sheet"),
  csv: S("#38A169", "data"),
  ods: S("#2F855A", "sheet"),
  docx: S("#2B6CE6", "doc"),
  doc: S("#2059C7", "doc"),
  odt: S("#3B82F6", "doc"),
  rtf: S("#4F7BD9", "doc"),
  pptx: S("#E2541B", "slides"),
  ppt: S("#C8461A", "slides"),
  key: S("#2F80ED", "slides"),
  pdf: S("#E03131", "pdf"),
  txt: S("#6B7280", "text"),
  md: S("#475569", "text"),
  log: S("#57606A", "text"),
  // Gambar
  png: S("#0EA5A4", "image"),
  jpg: S("#F08C00", "image"),
  jpeg: S("#E8590C", "image"),
  gif: S("#D6336C", "image"),
  webp: S("#7048E8", "image"),
  bmp: S("#5F6FBF", "image"),
  heic: S("#C2410C", "image"),
  tiff: S("#8A5A44", "image"),
  ico: S("#3B5BDB", "image"),
  svg: S("#F59F00", "vector", "#2B1D00"),
  raw: S("#495057", "image"),
  // Desain
  psd: S("#1E6FD9", "design"),
  ai: S("#E8700A", "design"),
  fig: S("#A259FF", "design"),
  xd: S("#C42E91", "design"),
  blend: S("#E87D0D", "design"),
  // Video
  mp4: S("#4C6EF5", "video"),
  mkv: S("#3B4FC4", "video"),
  mov: S("#5C5FD6", "video"),
  avi: S("#4263EB", "video"),
  webm: S("#5F3DC4", "video"),
  // Audio
  mp3: S("#E64980", "audio"),
  wav: S("#C2255C", "audio"),
  flac: S("#AE3EC9", "audio"),
  m4a: S("#D9480F", "audio"),
  ogg: S("#9C36B5", "audio"),
  aac: S("#E8590C", "audio"),
  // Arsip
  zip: S("#E0A800", "zip", "#2B2000"),
  rar: S("#862E9C", "zip"),
  "7z": S("#2F2F2F", "zip"),
  tar: S("#795548", "zip"),
  gz: S("#6D4C41", "zip"),
  // App & disk
  exe: S("#3F4A5A", "app"),
  msi: S("#2C5282", "app"),
  apk: S("#2F9E44", "app"),
  bat: S("#343A40", "code"),
  cmd: S("#343A40", "code"),
  iso: S("#5C6370", "disc"),
  dmg: S("#5C6370", "disc"),
  // Kode
  ts: S("#3178C6", "code"),
  tsx: S("#1F8DB3", "code"),
  js: S("#F0DB4F", "code", "#2B2600"),
  jsx: S("#20A4C8", "code"),
  py: S("#3776AB", "code"),
  rs: S("#B7410E", "code"),
  go: S("#00ADD8", "code"),
  java: S("#B07219", "code"),
  kt: S("#7F52FF", "code"),
  c: S("#555E8A", "code"),
  cpp: S("#00599C", "code"),
  cs: S("#68217A", "code"),
  php: S("#777BB4", "code"),
  rb: S("#CC342D", "code"),
  html: S("#E34F26", "code"),
  css: S("#1572B6", "code"),
  scss: S("#C6538C", "code"),
  vue: S("#3FB27F", "code"),
  svelte: S("#FF3E00", "code"),
  sh: S("#2D3748", "code"),
  sql: S("#336791", "data"),
  json: S("#6B7280", "data"),
  yml: S("#CB171E", "data"),
  yaml: S("#CB171E", "data"),
  toml: S("#9C4221", "data"),
  xml: S("#0A7E8C", "data"),
  db: S("#336791", "data"),
  // Font
  ttf: S("#495057", "font"),
  otf: S("#3D4451", "font"),
  woff: S("#3D4451", "font"),
  woff2: S("#3D4451", "font"),
};

/** Warna & gambar cadangan buat ekstensi yang belum kenal (dari huruf ekstensinya). */
function fallback(ext: string): Style {
  const palette = ["#5C7CFA", "#20C997", "#F76707", "#BE4BDB", "#228BE6", "#40C057", "#FA5252", "#FAB005"];
  let h = 0;
  for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return S(ext ? palette[h % palette.length] : "#6B7280", "file");
}

export function fileStyle(ext: string): Style {
  return STYLES[ext.toLowerCase()] ?? fallback(ext.toLowerCase());
}

const PAGE = "M8 2h18l10 10v31a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z";
const FOLD = "M26 2v7a3 3 0 0 0 3 3h7z";

function GlyphArt({ glyph, ink }: { glyph: Glyph; ink: string }) {
  const st = { stroke: ink, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (glyph) {
    case "sheet":
      return (
        <g {...st}>
          <rect x="11" y="13" width="16" height="15" rx="1.5" />
          <path d="M11 18h16M11 23h16M17 13v15" />
        </g>
      );
    case "data":
      return (
        <g {...st}>
          <ellipse cx="19" cy="15" rx="7" ry="2.6" />
          <path d="M12 15v10c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V15M12 20c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6" />
        </g>
      );
    case "doc":
    case "text":
      return (
        <g {...st}>
          <path d={glyph === "doc" ? "M12 14h14M12 18.5h14M12 23h10" : "M12 14h12M12 18.5h14M12 23h8"} />
        </g>
      );
    case "slides":
      return (
        <g {...st}>
          <rect x="11" y="13" width="16" height="11" rx="1.5" />
          <path d="M19 24v4M15.5 28h7" />
        </g>
      );
    case "pdf":
      return (
        <g {...st}>
          <path d="M13 27c2.5-1.8 4.6-6 5.6-11.4.3-1.6 1.9-1.5 2 .1.3 4.3-4.5 9.6-8.4 11.3-1.4.6-2-.9-.5-1.6 3.5-1.6 9.4-2.4 12.4-1.1 1.4.6 1 2.2-.5 1.8-3.4-.9-6.6-4.6-7.6-7.4" />
        </g>
      );
    case "image":
      return (
        <g {...st}>
          <rect x="11" y="13" width="16" height="14" rx="2" />
          <path d="M11.5 25l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4" />
          <circle cx="22.5" cy="17.5" r="1.4" fill={ink} stroke="none" />
        </g>
      );
    case "vector":
      return (
        <g {...st}>
          <path d="M12 26c1-6 4-10 7-11s6 3 7 11" />
          <rect x="17.5" y="13.5" width="3" height="3" fill={ink} stroke="none" />
          <rect x="10.5" y="24.5" width="3" height="3" fill={ink} stroke="none" />
          <rect x="24.5" y="24.5" width="3" height="3" fill={ink} stroke="none" />
        </g>
      );
    case "design":
      return (
        <g {...st}>
          <path d="M14 27l4-13 4 13M15.5 22.5h5M25 14v13" />
        </g>
      );
    case "video":
      return (
        <g>
          <rect x="11" y="13" width="16" height="14" rx="2" {...st} />
          <path d="M17 16.5v7l6-3.5z" fill={ink} />
        </g>
      );
    case "audio":
      return (
        <g {...st}>
          <path d="M16 25V15l9-2v10" />
          <circle cx="14" cy="25" r="2.2" fill={ink} stroke="none" />
          <circle cx="23" cy="23" r="2.2" fill={ink} stroke="none" />
        </g>
      );
    case "zip":
      return (
        <g {...st}>
          <path d="M19 6v3M19 11v2M19 15v2M19 19v2" strokeWidth={2.4} />
          <rect x="16.5" y="22" width="5" height="6" rx="1.2" />
        </g>
      );
    case "code":
      return (
        <g {...st}>
          <path d="M15 15l-4 5 4 5M23 15l4 5-4 5M20.5 13.5l-3 13" />
        </g>
      );
    case "app":
      return (
        <g {...st}>
          <rect x="11" y="13" width="16" height="14" rx="2" />
          <path d="M11 17h16" />
          <circle cx="13.5" cy="15" r=".6" fill={ink} stroke="none" />
          <circle cx="15.5" cy="15" r=".6" fill={ink} stroke="none" />
        </g>
      );
    case "disc":
      return (
        <g {...st}>
          <circle cx="19" cy="20" r="7.5" />
          <circle cx="19" cy="20" r="2" />
        </g>
      );
    case "font":
      return (
        <g {...st}>
          <path d="M13 27l6-14 6 14M15.3 22h7.4" />
        </g>
      );
    default:
      return (
        <g {...st}>
          <path d="M12 15h10M12 19.5h14M12 24h12" />
        </g>
      );
  }
}

function FileIconImpl({ ext, isDir, size = 44 }: { ext: string; isDir?: boolean; size?: number }) {
  if (isDir) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 48" aria-hidden="true" className="file-icon">
        <path d="M3 13a3 3 0 0 1 3-3h9l3.5 3.5H34a3 3 0 0 1 3 3V38a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#D9970B" />
        <path d="M3 18a3 3 0 0 1 3-3h28a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#F5B82E" />
        <path d="M3 18a3 3 0 0 1 3-3h28a3 3 0 0 1 3 3v2H3z" fill="#FFD166" opacity=".55" />
      </svg>
    );
  }
  const e = ext.toLowerCase();
  const st = fileStyle(e);
  const ink = st.ink ?? "#fff";
  const label = (e || "file").toUpperCase().slice(0, 5);
  const fs = label.length <= 3 ? 8.6 : label.length === 4 ? 7.2 : 6.1;
  return (
    <svg width={size} height={size} viewBox="0 0 40 48" aria-hidden="true" className="file-icon">
      <path d={PAGE} fill={st.color} />
      <path d={PAGE} fill="url(#fi-shine)" opacity=".35" />
      <path d={FOLD} fill="#000" opacity=".22" />
      <path d="M26 2v7a3 3 0 0 0 3 3h7" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1" />
      <defs>
        <linearGradient id="fi-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <GlyphArt glyph={st.glyph} ink={ink} />
      <text
        x="20.5"
        y="40.5"
        textAnchor="middle"
        fontSize={fs}
        fontWeight={800}
        letterSpacing=".3"
        fill={ink}
        fontFamily="Segoe UI, system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}

export const FileIcon = memo(FileIconImpl);
