/** Nama tool Claude Code dalam bahasa sehari-hari. */
const TOOL_LABEL = (): Record<string, string> => ({
  Read: tr("Baca", "Read"),
  Edit: "Edit",
  MultiEdit: "Edit",
  Write: tr("Tulis", "Write"),
  Bash: tr("Jalanin", "Run"),
  PowerShell: tr("Jalanin", "Run"),
  Glob: tr("Cari file", "Find files"),
  Grep: tr("Cari teks", "Search text"),
  WebFetch: tr("Buka web", "Fetch web"),
  WebSearch: tr("Cari di web", "Web search"),
  Task: "Subagent",
  Agent: "Subagent",
  TodoWrite: tr("Catat tugas", "Update todos"),
  NotebookEdit: tr("Edit notebook", "Edit notebook"),
  AskUserQuestion: tr("Nanya", "Ask"),
  ExitPlanMode: tr("Rencana", "Plan"),
  Skill: "Skill",
});
import { tr } from "../i18n";

export function toolLabel(name: string): string {
  return TOOL_LABEL()[name] ?? name.replace(/^mcp__/, "").replace(/__/g, " · ");
}
