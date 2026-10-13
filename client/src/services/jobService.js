import { apiRequest } from "./api.js";

// Durable background jobs (Trigger.dev). Starting a job returns promptly with an
// application job id; the caller polls for status and the bounded result.

// POST /api/jobs -> 202 { job, deduplicated } (200 when an identical request was
// deduplicated onto the job already in flight)
export async function startJob({ botId, chatId, message, idempotencyKey }) {
  return apiRequest("/jobs", {
    method: "POST",
    body: {
      botId,
      chatId,
      message,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  });
}

// GET /api/jobs -> { jobs, nextCursor }
export async function listJobs({ limit = 25, cursor, status } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (status) params.set("status", status);

  const payload = await apiRequest(`/jobs?${params.toString()}`);
  return {
    jobs: payload.jobs ?? [],
    nextCursor: payload.nextCursor ?? null,
  };
}

// GET /api/jobs/:jobId -> { job, reconciled }. `reconciled` is true when the
// server refreshed the status from Trigger.dev during this request.
export async function getJob(jobId) {
  return apiRequest(`/jobs/${encodeURIComponent(jobId)}`);
}

// GET /api/jobs/:jobId/steps -> { jobId, status, stepCount, steps }. The durable
// timeline of the job: each tool round it executed (ToolExecution) and each
// approval it raised, oldest first. Reads the same before and after a restart.
export async function getJobSteps(jobId) {
  const payload = await apiRequest(`/jobs/${encodeURIComponent(jobId)}/steps`);
  return {
    jobId: payload.jobId,
    status: payload.status,
    stepCount: payload.stepCount ?? 0,
    steps: payload.steps ?? [],
  };
}

// POST /api/jobs/:jobId/cancel -> { job, cancelled }
export async function cancelJob(jobId) {
  return apiRequest(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}
