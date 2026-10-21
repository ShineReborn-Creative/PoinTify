import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toolLabel } from "../../lib/tools";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Pip, type PipMood } from "../../components/Pip";
import { api } from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { useStore } from "../../lib/store";
import {
  chatStore,
  claudeStatusLoading,
  claudeStatusStore,
  detach,
  newChat,
  refreshClaudeStatus,
  sendMessage,
  stopMessage,
  switchChatProject,
  type Message,
  type Seg,
  type ToolSeg,
} from "../../state/chat";
import { guardBlur, pin } from "../../state/island";
import { settingsStore, updateSettings } from "../../state/settings";
import { tr } from "../../i18n";

const INSTALL_CMD = "irm https://claude.ai/install.ps1 | iex";

export function ChatTab({ mood }: { mood: PipMood }) {
  const status = useStore(claudeStatusStore);
  const loading = useStore(claudeStatusLoading);

  if (!status) {
    return (
      <div className="chat-setup">
        <Pip mood="thinking" size={56} glow />
        <div>
          <strong>{tr("Ngecek Claude Code…", "Checking Claude Code…")}</strong>
          <p className="muted">{tr("Bentar, gue liat dulu Claude Code udah terpasang di PC ini atau belum.", "Hang on, checking whether Claude Code is installed on this PC.")}</p>
        </div>
      </div>
    );
  }
  if (!status.installed) return <InstallCard loading={loading} />;
  if (!status.loggedIn) return <LoginCard loading={loading} />;
  return <ChatView mood={mood} />;
}

// ---------------------------------------------------------------------------
// Kartu setup
// ---------------------------------------------------------------------------

function InstallCard({ loading }: { loading: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="chat-setup">
      <Pip mood="notify" size={56} glow />
      <div className="setup-body">
        <strong>{tr("Pasang Claude Code dulu", "Install Claude Code first")}</strong>
        <p className="muted">
          {tr(
            "PoinTify ngobrol sama Claude lewat Claude Code, pakai login langganan Claude lu. Buka PowerShell, jalanin perintah ini, lalu klik Cek lagi. Fitur PoinTify yang lain tetap jalan tanpa ini.",
            "PoinTify talks to Claude through Claude Code, using your Claude subscription. Open PowerShell, run this command, then click Check again. The rest of PoinTify works without it.",
          )}
        </p>
        <div className="cmd-row">
          <code>{INSTALL_CMD}</code>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(INSTALL_CMD);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? tr("Tersalin", "Copied") : tr("Salin", "Copy")}
          </button>
        </div>
        <div className="setup-actions">
          <button className="btn btn-primary" onClick={() => void refreshClaudeStatus()} disabled={loading}>
            <Icon name="refresh" size={14} /> {loading ? tr("Ngecek…", "Checking…") : tr("Cek lagi", "Check again")}
          </button>
          <button className="btn ghost" onClick={() => void openUrl("https://code.claude.com/docs/en/setup")}>
            {tr("Panduan lengkap", "Full guide")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginCard({ loading }: { loading: boolean }) {
  return (
    <div className="chat-setup">
      <Pip mood="notify" size={56} glow />
      <div className="setup-body">
        <strong>{tr("Login ke Claude", "Log in to Claude")}</strong>
        <p className="muted">
          {tr(
            "Claude Code belum login, atau login-nya udah kedaluwarsa. Klik Login, nanti kebuka jendela terminal dan browser. Ikutin sampai beres, terus klik Cek lagi.",
            "Claude Code isn't logged in, or the login expired. Click Login and a terminal and browser window will open. Follow along until it's done, then click Check again.",
          )}
        </p>
        <div className="setup-actions">
          <button className="btn btn-primary" onClick={() => void api.claudeLogin()}>
            Login
          </button>
          <button className="btn" onClick={() => void refreshClaudeStatus()} disabled={loading}>
            <Icon name="refresh" size={14} /> {loading ? tr("Ngecek…", "Checking…") : tr("Cek lagi", "Check again")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function ChatView({ mood }: { mood: PipMood }) {
  const chat = useStore(chatStore);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.live]);

  return (
    <div className="chat">
      <ChatHeader />
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest("a");
          if (a?.href) {
            e.preventDefault();
            void openUrl(a.href);
          }
        }}
      >
        {chat.messages.length === 0 && !chat.running ? (
          <EmptyChat mood={mood} />
        ) : (
          <>
            {chat.messages.map((m, i) => (
              <MessageView key={m.id} message={m} showAvatar={chat.messages[i - 1]?.role !== "assistant"} />
            ))}
            {chat.running && (
              <LiveMessage
                segs={chat.live}
                mood={mood}
                showAvatar={chat.messages[chat.messages.length - 1]?.role !== "assistant"}
              />
            )}
          </>
        )}
      </div>
      <Composer />
    </div>
  );
}

function ChatHeader() {
  const settings = useStore(settingsStore);
  const chat = useStore(chatStore);
  const [menuOpen, setMenuOpen] = useState(false);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  if (!settings) return null;

  const active = settings.projects.find((p) => p.path === settings.activeProject);

  const choose = (path: string | null) => {
    updateSettings({ activeProject: path });
    switchChatProject(path);
    setMenuOpen(false);
  };

  const addFolder = async () => {
    guardBlur(120_000);
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: tr("Pilih folder project", "Choose a project folder") });
      if (typeof picked === "string") {
        const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? picked;
        const projects = settings.projects.some((p) => p.path === picked)
          ? settings.projects
          : [...settings.projects, { name, path: picked }];
        updateSettings({ projects, activeProject: picked });
        switchChatProject(picked);
      }
    } finally {
      guardBlur(400);
      setMenuOpen(false);
    }
  };

  return (
    <div className="chat-head">
      <div className="project-picker">
        <button className="chip" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} title={active?.path}>
          <Icon name="folder" size={14} />
          <span className="ellipsis">{active?.name ?? tr("Tanpa project", "No project")}</span>
          <Icon name="chevronDown" size={14} />
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button role="menuitem" className={!active ? "selected" : ""} onClick={() => choose(null)}>
              {tr("Tanpa project", "No project")}
              <span className="muted">{tr("Ngobrol bebas", "Free chat")}</span>
            </button>
            {settings.projects.map((p) => (
              <button
                key={p.path}
                role="menuitem"
                className={p.path === settings.activeProject ? "selected" : ""}
                onClick={() => choose(p.path)}
                title={p.path}
              >
                {p.name}
                <span className="muted ellipsis">{p.path}</span>
              </button>
            ))}
            <button role="menuitem" className="menu-add" onClick={() => void addFolder()}>
              <Icon name="plus" size={14} /> {tr("Tambah folder project…", "Add project folder…")}
            </button>
          </div>
        )}
      </div>

      <div className="segmented small" role="tablist" aria-label={tr("Mode Claude", "Claude mode")}>
        <button
          role="tab"
          aria-selected={settings.claudeMode !== "work"}
          className={settings.claudeMode !== "work" ? "active" : ""}
          onClick={() => updateSettings({ claudeMode: "chat" })}
          title={tr("Claude cuma baca dan diskusi, nggak ngubah file", "Claude only reads and discusses, no file changes")}
        >
          {tr("Ngobrol", "Chat")}
        </button>
        <button
          role="tab"
          aria-selected={settings.claudeMode === "work"}
          className={settings.claudeMode === "work" ? "active warn" : ""}
          onClick={() => updateSettings({ claudeMode: "work" })}
          title={tr("Claude boleh ngedit file di folder project", "Claude may edit files in the project folder")}
          disabled={!active}
        >
          {tr("Kerjain", "Work")}
        </button>
      </div>

      <select
        className="select"
        value={settings.claudeModel}
        onChange={(e) => updateSettings({ claudeModel: e.target.value })}
        aria-label={tr("Model Claude", "Claude model")}
      >
        <option value="opus">Opus</option>
        <option value="sonnet">Sonnet</option>
        <option value="haiku">Haiku</option>
      </select>

      <div className="chat-head-right">
        {desktopError && <span className="head-error" title={desktopError}>{tr("Gagal buka Desktop", "Couldn't open Desktop")}</span>}
        <button
          className="icon-btn"
          title={tr("Lanjutin di Claude Desktop", "Continue in Claude Desktop")}
          aria-label={tr("Lanjutin di Claude Desktop", "Continue in Claude Desktop")}
          onClick={() => {
            setDesktopError(null);
            api.claudeOpenDesktop(chat.sessionId, chat.key || null).catch((e) => setDesktopError(String(e)));
          }}
        >
          <Icon name="desktop" size={16} />
        </button>
        <button className="icon-btn" title={tr("Chat baru", "New chat")} aria-label={tr("Chat baru", "New chat")} onClick={newChat}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptyChat({ mood }: { mood: PipMood }) {
  const settings = useStore(settingsStore);
  const hasProject = !!settings?.activeProject;
  const work = settings?.claudeMode === "work";
  const ideas = hasProject
    ? work
      ? [
          tr("Rapihin kode di file yang terakhir gue ubah", "Tidy up the code in the files I changed last"),
          tr("Tambahin komentar yang jelas di fungsi-fungsi utama", "Add clear comments to the main functions"),
          tr("Cari dan benerin warning TypeScript", "Find and fix TypeScript warnings"),
        ]
      : [
          tr("Jelasin struktur project ini", "Explain this project's structure"),
          tr("Apa yang bisa ditingkatin dari project ini?", "What could be improved in this project?"),
          tr("Brainstorm fitur berikutnya", "Brainstorm the next feature"),
        ]
    : [
        tr("Bantu gue brainstorm ide project", "Help me brainstorm a project idea"),
        tr("Jelasin konsep ini pakai contoh sederhana", "Explain a concept with a simple example"),
        tr("Bikinin rencana belajar Rust seminggu", "Make me a one-week plan to learn Rust"),
      ];
  return (
    <div className="chat-empty">
      <Pip mood={mood === "sleep" ? "idle" : mood} size={60} glow interactive />
      <strong>{work ? tr("Mau dikerjain apa?", "What should we work on?") : tr("Mau ngobrolin apa?", "What do you want to talk about?")}</strong>
      <span className="muted">
        {hasProject
          ? work
            ? tr("Mode Kerjain: Claude boleh ngedit file di folder project ini.", "Work mode: Claude may edit files in this project folder.")
            : tr("Mode Ngobrol: Claude bisa baca project lu, tapi nggak ngubah apa-apa.", "Chat mode: Claude can read your project but won't change anything.")
          : tr("Pilih folder project di atas kalau mau Claude ngerti kode lu.", "Pick a project folder above if you want Claude to understand your code.")}
      </span>
      <div className="ideas">
        {ideas.map((t) => (
          <button key={t} className="chip" onClick={() => void sendMessage(t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

const MessageView = memo(function MessageView({ message, showAvatar }: { message: Message; showAvatar: boolean }) {
  if (message.role === "user") {
    const text = message.segs.map((s) => (s.kind === "text" ? s.text : "")).join("");
    return (
      <div className="msg user">
        {message.attachments?.length ? (
          <div className="msg-attachments">
            {message.attachments.map((a) => (
              <span key={a} className="attach-chip" title={a}>
                <Icon name="clip" size={12} />
                {basename(a)}
              </span>
            ))}
          </div>
        ) : null}
        <div className="bubble">{text}</div>
      </div>
    );
  }
  if (message.role === "error") {
    const text = message.segs.map((s) => (s.kind === "text" ? s.text : "")).join("");
    return (
      <div className="msg error">
        <Icon name="close" size={14} />
        <span>{text}</span>
      </div>
    );
  }
  return (
    <div className="msg assistant">
      <div className="avatar">{showAvatar && <Pip mood="idle" size={22} still />}</div>
      <div className="assistant-body">
        {message.segs.map((seg, i) => (
          <SegView key={i} seg={seg} />
        ))}
      </div>
    </div>
  );
});

function LiveMessage({ segs, mood, showAvatar }: { segs: Seg[]; mood: PipMood; showAvatar: boolean }) {
  return (
    <div className="msg assistant live">
      <div className="avatar">{showAvatar && <Pip mood={mood} size={22} />}</div>
      <div className="assistant-body">
        {segs.length === 0 ? (
          <span className="typing" aria-label={tr("Claude lagi mikir", "Claude is thinking")}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          segs.map((seg, i) => <SegView key={i} seg={seg} live={i === segs.length - 1} />)
        )}
      </div>
    </div>
  );
}

function SegView({ seg, live }: { seg: Seg; live?: boolean }) {
  if (seg.kind === "tool") return <ToolChip seg={seg} />;
  return (
    <div
      className={`md${live ? " streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.text) }}
    />
  );
}


function toolDetail(seg: ToolSeg): string {
  const i = seg.input ?? {};
  const pick = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  const path = pick("file_path") || pick("path") || pick("notebook_path");
  if (path) return basename(path);
  const cmd = pick("command");
  if (cmd) return cmd.length > 48 ? `${cmd.slice(0, 48)}…` : cmd;
  return pick("pattern") || pick("query") || pick("url") || pick("description") || "";
}

function ToolChip({ seg }: { seg: ToolSeg }) {
  const label = toolLabel(seg.name);
  const detail = toolDetail(seg);
  return (
    <div className={`tool-chip status-${seg.status}`}>
      {seg.status === "running" ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <Icon name={seg.status === "error" ? "close" : "check"} size={12} />
      )}
      <span className="tool-name">{label}</span>
      {detail && <span className="tool-detail ellipsis">{detail}</span>}
    </div>
  );
}

function Composer() {
  const chat = useStore(chatStore);
  const settings = useStore(settingsStore);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || chat.running) return;
    void sendMessage(text);
    setText("");
  };

  const work = settings?.claudeMode === "work";

  return (
    <div className="composer">
      {chat.attachments.length > 0 && (
        <div className="composer-attachments">
          {chat.attachments.map((a) => (
            <span key={a} className="attach-chip" title={a}>
              <Icon name="clip" size={12} />
              {basename(a)}
              <button aria-label={`${tr("Lepas", "Remove")} ${basename(a)}`} onClick={() => detach(a)}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={`composer-box${work ? " work" : ""}`}>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={work ? tr("Minta Claude ngerjain sesuatu di project ini…", "Ask Claude to do something in this project…") : tr("Tanya apa aja ke Claude…", "Ask Claude anything…")}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            pin(true);
            void api.focusIsland();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {chat.running ? (
          <button className="send-btn stop" aria-label={tr("Hentikan", "Stop")} title={tr("Hentikan", "Stop")} onClick={stopMessage}>
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button className="send-btn" aria-label={tr("Kirim", "Send")} title={tr("Kirim (Enter)", "Send (Enter)")} onClick={submit} disabled={!text.trim()}>
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
