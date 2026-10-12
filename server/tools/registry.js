import {
  todoCreateTool,
  todoListTool,
  todoUpdateTool,
  todoDeleteTool,
} from "./todo.js";
import {
  sandboxListFilesTool,
  sandboxReadFileTool,
  sandboxWriteFileTool,
  sandboxExecuteCommandTool,
} from "./sandbox.js";
import { browserTools } from "./browser.js";
import { webSearchTool } from "./search.js";

// Central tool registry. Add new tools here to make them available to the
// agent; the graph binds whatever this module exports. Each tool declares its
// own zod schema and description, and reads trusted execution context from the
// LangGraph runtime rather than from model-generated arguments.
export const tools = [
  // Task management
  todoCreateTool,
  todoListTool,
  todoUpdateTool,
  todoDeleteTool,
  // Workspace files and shell inside the teammate's sandbox
  sandboxListFilesTool,
  sandboxReadFileTool,
  sandboxWriteFileTool,
  sandboxExecuteCommandTool,
  // Real browser automation in the same sandbox, visible in the live view
  ...browserTools,
  // Web research (discovery), separate from browsing (inspection)
  webSearchTool,
];

export default tools;
