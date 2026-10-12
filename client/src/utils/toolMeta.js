import {
  ArrowLeft,
  Camera,
  FileText,
  FolderTree,
  Globe,
  Hand,
  Keyboard,
  ListChecks,
  MousePointerClick,
  Pencil,
  Plus,
  Search,
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
  browser_navigate: { label: "Open a URL", icon: Globe, group: "Browser" },
  browser_read_page: { label: "Read the page", icon: FileText, group: "Browser" },
  browser_get_links: { label: "Collect links", icon: Globe, group: "Browser" },
  browser_click: { label: "Click", icon: MousePointerClick, group: "Browser" },
  browser_type: { label: "Type into the page", icon: Keyboard, group: "Browser" },
  browser_press: { label: "Press a key", icon: Keyboard, group: "Browser" },
  browser_scroll: { label: "Scroll", icon: Hand, group: "Browser" },
  browser_wait_for: { label: "Wait for content", icon: Globe, group: "Browser" },
  browser_screenshot: { label: "Capture the viewport", icon: Camera, group: "Browser" },
  browser_history: { label: "Browser history", icon: ArrowLeft, group: "Browser" },
  web_search: { label: "Search the web", icon: Search, group: "Research" },
};

const UNKNOWN = { label: "Tool call", icon: Wrench, group: "Other" };

export function toolMeta(toolName) {
  return TOOL_META[toolName] ?? { ...UNKNOWN, label: toolName || UNKNOWN.label };
}
