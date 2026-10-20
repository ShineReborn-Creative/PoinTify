/** Set ikon kecil PoinTify. Garisnya tebal dan ujungnya membulat biar
 *  senada sama bentuk Pip. */

const PATHS: Record<string, string> = {
  home: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z",
  chat: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h0a2.5 2.5 0 0 1-2-2.5z",
  shelf: "M4 13.5 6.2 6.6A1.5 1.5 0 0 1 7.6 5.5h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zM4 13.5h4.5l1 2h5l1-2H20",
  timer: "M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 9.5v4l2.5 1.5M9.5 3h5",
  gear: "M4.5 7.5h8M16.5 7.5h3M4.5 16.5h3M11.5 16.5h8M14.5 5.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9.5 14.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  info: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 11v5M12 8h.01",
  volume: "M5 9.5h3l4-3.5v12l-4-3.5H5zM15.5 9a4 4 0 0 1 0 6M17.8 6.8a7 7 0 0 1 0 10.4",
  volumeOff: "M5 9.5h3l4-3.5v12l-4-3.5H5zM16 10l4 4M20 10l-4 4",
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z",
  prev: "M6.5 6v12M18 6.5v11L9.5 12z",
  next: "M17.5 6v12M6 6.5v11l8.5-5.5z",
  send: "M12 19V6M6.5 11.5 12 6l5.5 5.5",
  stop: "M7.5 7.5h9v9h-9z",
  plus: "M12 5.5v13M5.5 12h13",
  folder: "M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  trash: "M5.5 7h13M10 7V5h4v2M7 7l.8 11.5a1.5 1.5 0 0 0 1.5 1.5h5.4a1.5 1.5 0 0 0 1.5-1.5L17 7",
  open: "M13 5h6v6M19 5l-8 8M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10",
  reveal: "M4 7.5A1.5 1.5 0 0 1 5.5 6H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 11v5M9.5 13.5 12 16l2.5-2.5",
  clip: "M15.5 8.5 9.8 14.2a1.8 1.8 0 0 0 2.5 2.5l6.4-6.4a3.5 3.5 0 0 0-5-5l-6.6 6.6a5.2 5.2 0 0 0 7.4 7.4l5.3-5.3",
  check: "M5.5 12.5 10 17l8.5-9.5",
  drop: "M12 4c3 3.6 5.5 6.8 5.5 9.7a5.5 5.5 0 0 1-11 0C6.5 10.8 9 7.6 12 4z",
  refresh: "M18.5 9A7 7 0 0 0 6 7.5L4.5 9M5.5 15A7 7 0 0 0 18 16.5l1.5-1.5M4.5 5v4h4M19.5 19v-4h-4",
  desktop: "M4.5 5.5h15A1.5 1.5 0 0 1 21 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5zM9 20.5h6M12 17v3.5",
  chevronDown: "M7 10l5 5 5-5",
  file: "M7 3.5h6.5L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5zM13 3.5V8h5",
  image: "M5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5zM4 15.5l4.5-4.5 4 4 2.5-2.5 5 5M15.5 9.5h.01",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12",
  music: "M9 17.5V6.5l10-2v11M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
  skip: "M6 6.5v11l8.5-5.5zM17.5 6v12",
  reset: "M5 12a7 7 0 1 0 2-4.9L5 9M5 5v4h4",
  minus: "M5.5 12h13",
  zip: "M7 3.5h10A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM12 3.5v2M12 7.5v2M12 11.5v2M10.5 15.5h3v3h-3z",
  pin: "M9 4h6l-1 5 3 3v1.5H7V12l3-3zM12 13.5V20",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const filled = name === "play" || name === "pause" || name === "prev" || name === "next" || name === "stop" || name === "skip";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 1.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Ikon sesuai jenis file. */
export function fileIcon(ext: string, isDir: boolean): IconName {
  if (isDir) return "folder";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"].includes(ext)) return "image";
  if (["mp3", "wav", "flac", "m4a", "ogg", "aac"].includes(ext)) return "music";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "zip";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "cs", "php", "html", "css", "json", "toml", "yml", "yaml", "md", "sql", "sh"].includes(ext)) return "code";
  return "file";
}
