import { parseMaybeJson } from "./format.js";

// The sandbox Terminal, Files and Activity panels are derived entirely from the
// persisted tool executions returned by GET /api/tool-executions/:chatId.
//
// Nothing here invents data: if the teammate never ran a sandbox tool, these
// selectors return empty results and the UI shows an empty state. There is no
// frontend shell endpoint, by design, so the UI never executes commands itself.

export const SANDBOX_TOOLS = {
  listFiles: "sandbox_list_files",
  readFile: "sandbox_read_file",
  writeFile: "sandbox_write_file",
  executeCommand: "sandbox_execute_command",
};

function parseArgs(execution) {
  return parseMaybeJson(execution?.args) ?? {};
}

function parseResult(execution) {
  return parseMaybeJson(execution?.result);
}

function timeOf(execution) {
  const value = execution?.completedAt ?? execution?.createdAt;
  const date = new Date(value ?? 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

// Chronological command transcript from sandbox_execute_command records.
export function commandTranscript(executions) {
  return (executions ?? [])
    .filter((execution) => execution.toolName === SANDBOX_TOOLS.executeCommand)
    .map((execution) => {
      const args = parseArgs(execution);
      const result = parseResult(execution);

      return {
        id: execution.id,
        command: typeof args.command === "string" ? args.command : "",
        cwd: typeof args.cwd === "string" ? args.cwd : null,
        exitCode: typeof result?.exitCode === "number" ? result.exitCode : null,
        output: typeof result?.output === "string" ? result.output : "",
        truncated: Boolean(result?.truncated),
        status: execution.status,
        error: execution.error ?? null,
        durationMs: execution.durationMs ?? null,
        completedAt: execution.completedAt ?? execution.createdAt,
      };
    })
    .sort((a, b) => new Date(a.completedAt ?? 0) - new Date(b.completedAt ?? 0));
}

// The most recent successful directory listing recorded for this chat.
export function latestFileListing(executions) {
  const candidate = (executions ?? [])
    .filter(
      (execution) =>
        execution.toolName === SANDBOX_TOOLS.listFiles && execution.status !== "FAILED",
    )
    .sort((a, b) => timeOf(b) - timeOf(a))[0];

  if (!candidate) return null;

  const result = parseResult(candidate);
  if (!result || !Array.isArray(result.entries)) return null;

  return {
    id: candidate.id,
    path: typeof result.path === "string" ? result.path : ".",
    truncated: Boolean(result.truncated),
    entries: result.entries.map((entry) => ({
      name: entry?.name ?? entry?.path ?? "unnamed",
      path: entry?.path ?? entry?.name ?? "",
      isDir: Boolean(entry?.isDir),
      size: typeof entry?.size === "number" ? entry.size : null,
    })),
    recordedAt: candidate.completedAt ?? candidate.createdAt,
  };
}

// The most recent successful file read, optionally for a specific path.
export function latestFileContent(executions, preferredPath) {
  const reads = (executions ?? [])
    .filter(
      (execution) =>
        execution.toolName === SANDBOX_TOOLS.readFile && execution.status !== "FAILED",
    )
    .map((execution) => ({
      execution,
      result: parseResult(execution),
      args: parseArgs(execution),
    }))
    .filter((entry) => entry.result && typeof entry.result.content === "string")
    .sort((a, b) => timeOf(b.execution) - timeOf(a.execution));

  if (reads.length === 0) return null;

  const match =
    (preferredPath && reads.find((entry) => entry.result.path === preferredPath)) || reads[0];

  return {
    id: match.execution.id,
    path: match.result.path ?? match.args.path ?? "file",
    content: match.result.content,
    bytes: typeof match.result.bytes === "number" ? match.result.bytes : null,
    truncated: Boolean(match.result.truncated),
    recordedAt: match.execution.completedAt ?? match.execution.createdAt,
  };
}

// Files the teammate created or overwrote, newest first.
export function recentWrites(executions) {
  return (executions ?? [])
    .filter(
      (execution) =>
        execution.toolName === SANDBOX_TOOLS.writeFile && execution.status !== "FAILED",
    )
    .map((execution) => {
      const args = parseArgs(execution);
      const result = parseResult(execution);
      return {
        id: execution.id,
        path: result?.path ?? args.path ?? "file",
        bytes: typeof result?.bytes === "number" ? result.bytes : null,
        recordedAt: execution.completedAt ?? execution.createdAt,
      };
    })
    .sort((a, b) => new Date(b.recordedAt ?? 0) - new Date(a.recordedAt ?? 0));
}

// Summary counts used by the panel headers. `files` counts every file operation
// the Files pane renders (list, read and write) so the tab badge matches the
// pane's contents.
const FILE_TOOLS = [SANDBOX_TOOLS.listFiles, SANDBOX_TOOLS.readFile, SANDBOX_TOOLS.writeFile];

export function sandboxSummary(executions) {
  const list = executions ?? [];
  return {
    total: list.length,
    failures: list.filter((execution) => execution.status === "FAILED").length,
    commands: list.filter((execution) => execution.toolName === SANDBOX_TOOLS.executeCommand).length,
    files: list.filter((execution) => FILE_TOOLS.includes(execution.toolName)).length,
  };
}
