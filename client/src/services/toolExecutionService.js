import { apiRequest } from "./api.js";

// GET /api/tool-executions/:chatId -> { executions, nextCursor }
//
// These are the real, persisted tool invocations for a chat: tool name,
// arguments, status, bounded result, error, timestamps and duration. The sandbox
// Terminal, Files and Activity panels are all derived from this single source of
// truth rather than from invented data.
export async function listToolExecutions(chatId, { limit = 50, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);

  const payload = await apiRequest(
    `/tool-executions/${encodeURIComponent(chatId)}?${params.toString()}`,
  );

  return {
    executions: payload.executions ?? [],
    nextCursor: payload.nextCursor ?? null,
  };
}
