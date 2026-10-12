import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  executeWorkspaceCommand,
} from "../sandbox.js";

// Trusted teammate/user context is injected by server-side code through the
// LangGraph runtime config. The model cannot choose which teammate's sandbox is
// used, and every operation re-verifies ownership in the sandbox service.
function getTrustedContext(runtime) {
  const configured = runtime?.config?.configurable ?? runtime?.configurable ?? {};
  const { userId, botId } = configured;

  if (!userId || !botId) {
    // Without this context the sandbox service would have no trusted bot to
    // resolve, so the call is rejected before any provider request.
    console.warn("[sandbox-tool] rejected call: missing trusted userId/botId in runtime config");
    throw new Error("Sandbox tools are not available in this context.");
  }

  return { userId, botId };
}

export const sandboxListFilesTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    return listWorkspaceFiles({ userId, botId, path: input.path });
  },
  {
    name: "sandbox_list_files",
    description:
      "List files and directories inside the teammate's isolated sandbox " +
      "workspace. Use relative paths within the workspace only.",
    schema: z.object({
      path: z
        .string()
        .max(1024)
        .optional()
        .describe("Relative directory inside the workspace. Defaults to the workspace root."),
    }),
  },
);

export const sandboxReadFileTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    return readWorkspaceFile({ userId, botId, path: input.path });
  },
  {
    name: "sandbox_read_file",
    description:
      "Read a text file from the teammate's isolated sandbox workspace. " +
      "Provide a path relative to the workspace root.",
    schema: z.object({
      path: z
        .string()
        .min(1)
        .max(1024)
        .describe("Relative path of the file to read inside the workspace."),
    }),
  },
);

export const sandboxWriteFileTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    return writeWorkspaceFile({
      userId,
      botId,
      path: input.path,
      content: input.content,
    });
  },
  {
    name: "sandbox_write_file",
    description:
      "Create or overwrite a text file in the teammate's isolated sandbox " +
      "workspace. Provide a relative path and the file contents.",
    schema: z.object({
      path: z
        .string()
        .min(1)
        .max(1024)
        .describe("Relative path of the file to write inside the workspace."),
      content: z.string().describe("Full text content to write to the file."),
    }),
  },
);

export const sandboxExecuteCommandTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    return executeWorkspaceCommand({
      userId,
      botId,
      command: input.command,
      cwd: input.cwd,
    });
  },
  {
    name: "sandbox_execute_command",
    description:
      "Run a shell command inside the teammate's isolated sandbox, never on " +
      "the host. Returns the exit code and bounded output. Commands run in the " +
      "sandbox workspace by default.",
    schema: z.object({
      command: z
        .string()
        .min(1)
        .max(2000)
        .describe("The shell command to run inside the sandbox."),
      cwd: z
        .string()
        .max(1024)
        .optional()
        .describe("Relative working directory inside the workspace."),
    }),
  },
);
