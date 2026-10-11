import {
  FileText,
  FolderTree,
  ListChecks,
  Pencil,
  Plus,
  SquareTerminal,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";

// Display metadata for the tools registered in server/tools/registry.js. Purely
// presentational: an unknown tool name still renders with a neutral icon, so a
// newly registered server tool never breaks the UI.
const TOOL_META = {
  todo_create: { label: "Create task", icon: Plus, group: "Tasks" },
  todo_list: { label: "List tasks", icon: ListChecks, group: "Tasks" },
  todo_update: { label: "Update task", icon: Pencil, group: "Tasks" },
  todo_delete: { label: "Delete task", icon: Trash2, group: "Tasks" },
  sandbox_list_files: { label: "List files", icon: FolderTree, group: "Sandbox" },
  sandbox_read_file: { label: "Read file", icon: FileText, group: "Sandbox" },
  sandbox_write_file: { label: "Write file", icon: FileText, group: "Sandbox" },
  sandbox_execute_command: { label: "Run command", icon: SquareTerminal, group: "Sandbox" },
  handoff_to_teammate: { label: "Hand off to teammate", icon: Users, group: "Teammates" },
};

const UNKNOWN = { label: "Tool call", icon: Wrench, group: "Other" };

export function toolMeta(toolName) {
  return TOOL_META[toolName] ?? { ...UNKNOWN, label: toolName || UNKNOWN.label };
}
