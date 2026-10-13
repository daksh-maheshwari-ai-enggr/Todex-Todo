import { prisma } from "./prisma.js";

// Persistence and lifecycle handling for durable background AI jobs.
//
// This module owns the application's own record of a job. Trigger.dev owns
// execution; the AiJob row is the source of truth for ownership, bounded
// results and the app-visible status. Nothing here talks to Trigger.dev and
// nothing here is reachable from a client without an ownership check.

// Identifier of the Trigger.dev task that executes background jobs. The task
// definition (trigger/ai-job.js) and the dispatcher (backgroundJobs.js) both
// read it from here, so the two can never drift apart.
export const AI_JOB_TASK_ID = "ai-teammate-job";

// Bounded storage limits. Keep only what is useful for displaying a result or
// explaining a failure; never a stack trace and never a secret.
const MAX_RESULT_LENGTH = 4000;
const MAX_ERROR_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 4000;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// A job is "active" until it reaches a terminal state. Terminal states are
// final: no later update (retry, hook or read-time reconciliation) may move a
// finished job back into an active state. WAITING_FOR_USER is active-but-parked:
// the run stopped on a human approval and only the approval response (or a
// cancellation) may move it again.
const ACTIVE_STATUSES = ["QUEUED", "RUNNING", "WAITING_FOR_USER"];
const TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED"];

// Which states a job may safely be cancelled from. A job waiting on an approval
// is cancellable too — its Trigger run has already ended, so cancellation is
// handled locally (see backgroundJobs.cancelBackgroundJob).
const CANCELLABLE_STATUSES = ["QUEUED", "RUNNING", "WAITING_FOR_USER"];

// Ordering of the active states so reconciliation can never move a job
// backwards. Trigger.dev reports QUEUED again while a run is in retry backoff
// or waiting, which must not undo a RUNNING job in the application.
const ACTIVE_RANK = { QUEUED: 0, RUNNING: 1 };

// Trigger.dev run status -> application job status. Verified against the run
// status enum documented in the installed @trigger.dev/sdk v4.7.3.
const RUN_STATUS_TO_APP = {
  PENDING_VERSION: "QUEUED",
  QUEUED: "QUEUED",
  DELAYED: "QUEUED",
  WAITING: "QUEUED",
  DEQUEUED: "RUNNING",
  EXECUTING: "RUNNING",
  COMPLETED: "SUCCEEDED",
  CANCELED: "CANCELLED",
  FAILED: "FAILED",
  CRASHED: "FAILED",
  SYSTEM_FAILURE: "FAILED",
  TIMED_OUT: "FAILED",
  EXPIRED: "FAILED",
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status);
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function isCancellableStatus(status) {
  return CANCELLABLE_STATUSES.includes(status);
}

// Pure reconciliation policy: fold a Trigger.dev run status into the
// application status.
//
//   * An unknown run status yields null, meaning "no status change".
//   * A job that already finished keeps its stored outcome: the result the user
//     can already read is never rewritten by a later provider read.
//   * An active job never moves backwards, so a run that reports a queueing
//     status again cannot undo a started job.
export function resolveAppStatus(currentStatus, runStatus) {
  // A parked job (waiting on the human) is never moved by run reconciliation:
  // its Trigger run ended normally on purpose. Only the approval response
  // (RUNNING again) or an explicit cancellation may change it.
  if (currentStatus === "WAITING_FOR_USER") return "WAITING_FOR_USER";

  const mapped = RUN_STATUS_TO_APP[runStatus] ?? null;
  if (!mapped) return null;

  if (isTerminalStatus(currentStatus)) return currentStatus;

  if (
    isActiveStatus(mapped) &&
    isActiveStatus(currentStatus) &&
    ACTIVE_RANK[mapped] < ACTIVE_RANK[currentStatus]
  ) {
    return currentStatus;
  }

  return mapped;
}

// Turn any thrown value into a short, safe message. Stack traces, error codes
// and provider payloads are deliberately dropped.
export function sanitizeError(error) {
  if (error == null) return "Unknown error.";
  const message =
    typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "";
  const text = message.trim() || "Unknown error.";
  return text.length > MAX_ERROR_LENGTH ? text.slice(0, MAX_ERROR_LENGTH) : text;
}

// Errors that can never succeed on a retry: the request itself was invalid, or
// the resources it referred to no longer exist. Everything else (provider
// timeouts, network failures, unexpected crashes, aborted requests) is treated
// as transient and may be retried.
const NON_RETRYABLE_STATUSES = [400, 401, 403, 404, 409, 413, 422];

export function isRetryableJobError(error) {
  // The runner can mark an error explicitly (e.g. a cancellation detected
  // mid-turn) to stop retries regardless of its status.
  if (error?.retryable === false) return false;

  const status = Number(error?.status);
  if (Number.isFinite(status) && NON_RETRYABLE_STATUSES.includes(status)) {
    return false;
  }

  return true;
}

function truncate(value, maxLength) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : String(value);
  if (text.length === 0) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Public shape returned to clients. Internal provider identifiers are included
// only because they are already scoped to the authenticated user's own job.
export function toPublicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    chatId: job.chatId,
    botId: job.botId,
    message: job.message,
    result: job.result,
    error: job.error,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    assistantMessageId: job.assistantMessageId,
    // The approval a WAITING_FOR_USER job is parked on, so the UI can link
    // straight to the card that unblocks it.
    waitingForApprovalId:
      job.status === "WAITING_FOR_USER" ? job.lastApprovalId ?? null : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

// Create the application job record before anything is dispatched.
//
// When the caller supplies an idempotency key, an identical previous request is
// returned instead of creating a second job (and therefore a second run). A job
// that failed before it ever reached Trigger.dev (no runId) is safely retryable,
// so it is reset rather than returned as a permanent failure.
export async function createJob({
  userId,
  chatId,
  botId,
  message,
  idempotencyKey = null,
  maxAttempts,
}) {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) {
    throw httpError(400, "A background job requires a non-empty message.");
  }

  const data = {
    userId,
    chatId,
    botId,
    message: trimmed.slice(0, MAX_MESSAGE_LENGTH),
    maxAttempts,
  };

  if (idempotencyKey) {
    const existing = await prisma.aiJob.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });

    if (existing) {
      const neverDispatched = existing.status === "FAILED" && !existing.runId;
      if (!neverDispatched) {
        return { job: existing, deduplicated: true };
      }

      const job = await prisma.aiJob.update({
        where: { id: existing.id },
        data: {
          status: "QUEUED",
          chatId,
          botId,
          message: data.message,
          error: null,
          result: null,
          startedAt: null,
          completedAt: null,
        },
      });
      return { job, deduplicated: false };
    }
  }

  const job = await prisma.aiJob.create({
    data: { ...data, idempotencyKey: idempotencyKey || null },
  });

  return { job, deduplicated: false };
}

// Load a job for the authenticated owner. Returns null when the job does not
// exist or belongs to someone else, so callers cannot distinguish the two.
export async function findJobForUser(jobId, userId) {
  if (!jobId || typeof jobId !== "string") return null;
  return prisma.aiJob.findFirst({ where: { id: jobId, userId } });
}

// Load a job by id without an ownership filter. Only trusted server-side code
// (the background task runner) may use this.
export async function findJobById(jobId) {
  if (!jobId || typeof jobId !== "string") return null;
  return prisma.aiJob.findUnique({ where: { id: jobId } });
}

// Record a successful dispatch: the run now exists in Trigger.dev.
export async function attachRun({ jobId, runId, status = "RUNNING" }) {
  return prisma.aiJob.update({
    where: { id: jobId },
    data: {
      runId,
      status,
      runStatus: null,
      attemptCount: 1,
      startedAt: new Date(),
      error: null,
      completedAt: null,
    },
  });
}

// Record a resumption dispatch: the approval was answered and a new run now
// exists. Keeps attemptCount/startedAt bookkeeping from the original dispatch
// and clears the waiting markers.
export async function attachResumeRun({ jobId, runId }) {
  return prisma.aiJob.update({
    where: { id: jobId },
    data: {
      runId,
      status: "RUNNING",
      runStatus: null,
      waitSince: null,
      error: null,
      completedAt: null,
    },
  });
}

// A dispatch that threw left no run behind. Record it as a real failure so the
// job is never left silently claiming to be queued.
export async function markDispatchFailure({ jobId, error }) {
  return prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      error: sanitizeError(error),
      completedAt: new Date(),
    },
  });
}

// Mark a job as actively executing. Safe to call on every attempt: it never
// resurrects a job that already finished.
export async function markJobRunning({ jobId, attemptCount, runStatus = null }) {
  const job = await findJobById(jobId);
  if (!job || isTerminalStatus(job.status)) return job;

  return prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      ...(attemptCount ? { attemptCount } : {}),
      ...(runStatus ? { runStatus } : {}),
      startedAt: job.startedAt ?? new Date(),
      waitSince: null,
    },
  });
}

// Remember the user message that belongs to this job so a retry reuses it
// instead of writing a duplicate chat message.
export async function setJobUserMessage({ jobId, userMessageId }) {
  return prisma.aiJob.update({
    where: { id: jobId },
    data: { userMessageId },
  });
}

// Persist a terminal outcome. Terminal states are sticky: an update is ignored
// when the job already finished, except that a stored result is never cleared.
export async function finishJob({
  jobId,
  status,
  result = null,
  error = null,
  assistantMessageId = null,
  runStatus = null,
}) {
  if (!TERMINAL_STATUSES.includes(status)) {
    throw httpError(400, "Invalid job status.");
  }

  const job = await findJobById(jobId);
  if (!job) {
    throw httpError(404, "Job not found.");
  }

  if (isTerminalStatus(job.status)) {
    // Keep the first terminal outcome, but allow a failed/cancelled job to be
    // upgraded to SUCCEEDED only when it genuinely produced a result.
    if (job.status === "SUCCEEDED" || status !== "SUCCEEDED") {
      return job;
    }
  }

  return prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status,
      result: truncate(result, MAX_RESULT_LENGTH),
      error: truncate(error, MAX_ERROR_LENGTH),
      assistantMessageId: assistantMessageId || null,
      ...(runStatus ? { runStatus } : {}),
      completedAt: new Date(),
    },
  });
}

// Apply read-time reconciliation from a Trigger.dev run status. The policy
// lives in resolveAppStatus; this only persists its decision. Only the
// status/error fields are touched, so a bounded result already stored is kept.
export async function applyRunState({ jobId, runStatus, error = null }) {
  const job = await findJobById(jobId);
  if (!job) return null;

  const appStatus = resolveAppStatus(job.status, runStatus);

  const data = { runStatus: runStatus || job.runStatus };
  if (appStatus && appStatus !== job.status) {
    data.status = appStatus;
  }

  if (appStatus && isTerminalStatus(appStatus)) {
    data.completedAt = job.completedAt ?? new Date();
    if (appStatus === "FAILED" && error) {
      data.error = truncate(error, MAX_ERROR_LENGTH);
    }
  }

  return prisma.aiJob.update({ where: { id: jobId }, data });
}

// List the authenticated user's own jobs, newest first, with a bounded page
// size and optional id-based cursor and status filter.
export async function listJobsForUser(userId, { limit, cursor, status } = {}) {
  const parsedLimit = Number(limit);
  const take = Math.min(
    Math.max(1, Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const where = { userId };
  if (status) {
    const normalized = String(status).toUpperCase();
    if (![...ACTIVE_STATUSES, ...TERMINAL_STATUSES].includes(normalized)) {
      throw httpError(400, "Unknown job status filter.");
    }
    where.status = normalized;
  }

  const jobs = await prisma.aiJob.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      chatId: true,
      botId: true,
      message: true,
      result: true,
      error: true,
      attemptCount: true,
      maxAttempts: true,
      assistantMessageId: true,
      lastApprovalId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  const hasMore = jobs.length > take;
  const page = hasMore ? jobs.slice(0, take) : jobs;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { jobs: page, nextCursor };
}
