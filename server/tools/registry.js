import {
  todoCreateTool,
  todoListTool,
  todoUpdateTool,
  todoDeleteTool,
} from "./todo.js";

// Central tool registry. Add new tools here to make them available to the
// agent; the graph binds whatever this module exports. Each tool declares its
// own zod schema and description, and reads trusted execution context from the
// LangGraph runtime rather than from model-generated arguments.
export const tools = [
  todoCreateTool,
  todoListTool,
  todoUpdateTool,
  todoDeleteTool,
];

export default tools;
