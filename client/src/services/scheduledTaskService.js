import { apiRequest } from "./api.js";

// Scheduled / proactive teammate runs (ROADMAP.md Phase D).
//
// A task is a standing instruction that dispatches the same durable background
// job a manual run does, so its results, approvals and step budgets all land in
// the linked chat exactly like a manual run.

// POST /api/scheduled-tasks -> 201 { task }
// `runAt` is an ISO instant (one-shot, or the first run of a repeating task);
// `intervalMinutes` makes it repeat. Supplying only one is enough.
export async function createScheduledTask({ botId, chatId, goal, runAt, intervalMinutes }) {
  const payload = await apiRequest("/scheduled-tasks", {
    method: "POST",
    body: {
      botId,
      chatId,
      goal,
      ...(runAt ? { runAt } : {}),
      ...(intervalMinutes != null ? { intervalMinutes } : {}),
    },
  });
  return payload?.task ?? null;
}

// GET /api/scheduled-tasks -> { tasks, nextCursor }
export async function listScheduledTasks({ limit = 25, cursor, status } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (status) params.set("status", status);

  const payload = await apiRequest(`/scheduled-tasks?${params.toString()}`);
  return {
    tasks: payload.tasks ?? [],
    nextCursor: payload.nextCursor ?? null,
  };
}

// PATCH /api/scheduled-tasks/:id -> { task }
// `status` pauses/resumes; `runAt`/`intervalMinutes` reschedule (one clears the
// other, because a task is either one-shot or repeating).
export async function updateScheduledTask(taskId, patch) {
  const payload = await apiRequest(`/scheduled-tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: patch,
  });
  return payload?.task ?? null;
}

// DELETE /api/scheduled-tasks/:id -> { deleted, taskId, cancelledRun }
export async function deleteScheduledTask(taskId) {
  return apiRequest(`/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

// POST /api/scheduled-tasks/:id/run -> 202 { taskId, jobId }
// Starts one run immediately without changing the schedule.
export async function runScheduledTaskNow(taskId) {
  return apiRequest(`/scheduled-tasks/${encodeURIComponent(taskId)}/run`, { method: "POST" });
}
