/** Nama tool Claude Code dalam bahasa sehari-hari. */
const TOOL_LABEL: Record<string, string> = {
  Read: "Baca",
  Edit: "Edit",
  MultiEdit: "Edit",
  Write: "Tulis",
  Bash: "Jalanin",
  PowerShell: "Jalanin",
  Glob: "Cari file",
  Grep: "Cari teks",
  WebFetch: "Buka web",
  WebSearch: "Cari di web",
  Task: "Subagent",
  Agent: "Subagent",
  TodoWrite: "Catat tugas",
  NotebookEdit: "Edit notebook",
  AskUserQuestion: "Nanya",
  ExitPlanMode: "Rencana",
  Skill: "Skill",
};

export function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/^mcp__/, "").replace(/__/g, " · ");
}
