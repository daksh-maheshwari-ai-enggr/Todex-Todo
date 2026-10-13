import { tasks, runs } from "@trigger.dev/sdk";
import { config } from "./config.js";
import { prisma } from "./prisma.js";
import { MAX_MESSAGE_LENGTH } from "./agent.js";
import { getChatParticipantsForAgent } from "./chats.js";
import {
  AI_JOB_TASK_ID,
  applyRunState,
  attachRun,
  attachResumeRun,
  createJob,
  findJobForUser,
  finishJob,
  isActiveStatus,
  isCancellableStatus,
  listJobsForUser,
  markDispatchFailure,
  resolveAppStatus,
  sanitizeError,
  toPublicJob,
} from "./jobs.js";
import { cancelPendingApprovals } from "./approvals.js";

// Trigger.dev is the durable execution layer; Express stays the API layer.
//
// All SDK usage lives here. This module never runs the agent itself - it only
// validates ownership, records the application job, dispatches the documented
// task, and reconciles the application status against the Trigger.dev run.
//
// The Trigger.dev payload is intentionally just `{ jobId }`. Trusted context
// (owner, chat, teammate, message, conversation history) is loaded from the
// database inside the task, so no credentials or conversation state are ever
// serialized into a provider payload.

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertConfigured() {
  if (!config.triggerDev.enabled) {
    throw httpError(503, "Background jobs are not configured.");
  }
}

function assertNonEmptyString(value, field) {
  if (!value || typeof value !== "string" || value.length === 0) {
    throw httpError(400, `${field} is required and must be a non-empty string.`);
  }
}

// Resolve the owning bot and chat and confirm the teammate may act in the chat.
// Mirrors the synchronous respond route so both paths enforce identical rules.
async function resolveOwnedContext({ userId, botId, chatId }) {
  const bot = await prisma.bot.findFirst({ where: { id: botId, userId } });
  if (!bot) {
    throw httpError(404, "Bot not found.");
  }

  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId } });
  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
  }

  let participants;
  if (chat.botId) {
    if (chat.botId !== botId) {
      throw httpError(404, "Chat not found or does not belong to this bot.");
    }
    participants = [bot];
  } else {
    participants = await getChatParticipantsForAgent(chat);
    if (!participants.some((participant) => participant.id === botId)) {
      throw httpError(404, "Bot is not a participant in this chat.");
    }
  }

  return { bot, chat, participants };
}

// Validate the request, record the job and dispatch it. Returns promptly with
// the application job; it never waits for the AI turn to finish.
export async function startBackgroundJob({ userId, botId, chatId, message, idempotencyKey }) {
  // Input validation runs before the configuration check so a malformed request
  // is reported as a client error rather than a misleading "not configured".
  assertNonEmptyString(botId, "botId");
  assertNonEmptyString(chatId, "chatId");

  if (typeof message !== "string" || message.trim().length === 0) {
    throw httpError(400, "message is required and must be a non-empty string.");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw httpError(400, `message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`);
  }

  if (idempotencyKey != null) {
    assertNonEmptyString(idempotencyKey, "idempotencyKey");
    if (idempotencyKey.length > 200) {
      throw httpError(400, "idempotencyKey exceeds the maximum length of 200 characters.");
    }
  }

  // Only touch the database or the provider once the request is valid and a
  // secret key is present.
  assertConfigured();

  // Ownership, chat membership and teammate identity are all verified before a
  // job row exists.
  await resolveOwnedContext({ userId, botId, chatId });

  const { job, deduplicated } = await createJob({
    userId,
    chatId,
    botId,
    message,
    idempotencyKey: idempotencyKey || null,
    maxAttempts: config.triggerDev.maxAttempts,
  });

  // A repeated request with the same idempotency key returns the job that is
  // already in flight instead of dispatching a second run.
  if (deduplicated) {
    return { job: toPublicJob(job), deduplicated: true };
  }

  try {
    const handle = await tasks.trigger(
      AI_JOB_TASK_ID,
      { jobId: job.id },
      {
        // Dispatch-level deduplication: re-dispatching the same application job
        // (for example after a crash between these two writes) reuses the run
        // Trigger.dev already has instead of starting a second one.
        idempotencyKey: `ai-job:${job.id}`,
        maxAttempts: job.maxAttempts,
        tags: [`user:${userId}`, `job:${job.id}`],
      },
    );

    // Persist the run id only after dispatch actually succeeded. If this write
    // fails, the job stays QUEUED but the task still finds it by id from its own
    // payload and drives it to a terminal state, so nothing is stranded.
    const attached = await attachRun({ jobId: job.id, runId: handle.id });
    return { job: toPublicJob(attached), deduplicated: false };
  } catch (error) {
    // Never leave a job silently claiming to be queued when dispatch failed.
    const failed = await markDispatchFailure({ jobId: job.id, error });
    const dispatchError = httpError(503, "Failed to dispatch the background job.");
    dispatchError.job = toPublicJob(failed);
    throw dispatchError;
  }
}

// Resume a job that was parked on a human approval: dispatch a fresh run for
// the same job carrying the resolved approval id. The caller has already
// resolved the approval (respondApproval verified ownership). The idempotency
// key is per-approval so a double-click can never start two resume runs.
export async function resumeBackgroundJob({ userId, job, approval }) {
  assertNonEmptyString(job?.id, "jobId");
  assertNonEmptyString(approval?.id, "approvalId");
  assertConfigured();

  try {
    const handle = await tasks.trigger(
      AI_JOB_TASK_ID,
      { jobId: job.id, resumeApprovalId: approval.id },
      {
        idempotencyKey: `ai-job-resume:${approval.id}`,
        maxAttempts: job.maxAttempts,
        tags: [`user:${userId}`, `job:${job.id}`],
      },
    );

    // Persist the new run id and flip WAITING_FOR_USER -> RUNNING. If this
    // write fails the job stays parked but the run is idempotent, so the next
    // response can dispatch again without duplicating work.
    const attached = await attachResumeRun({ jobId: job.id, runId: handle.id });
    return { job: toPublicJob(attached) };
  } catch (error) {
    console.error("Failed to dispatch approval resume:", error?.message);
    throw httpError(503, "Failed to resume the background job.");
  }
}

// Retrieve one of the authenticated user's own jobs, actively reconciling the
// application status with Trigger.dev while the run is still active.
export async function getBackgroundJob({ userId, jobId }) {
  assertNonEmptyString(jobId, "jobId");

  const job = await findJobForUser(jobId, userId);
  if (!job) {
    throw httpError(404, "Job not found.");
  }

  // Nothing to reconcile for a finished job, a job that never reached
  // Trigger.dev, or an unconfigured deployment.
  if (!isActiveStatus(job.status) || !job.runId || !config.triggerDev.enabled) {
    return { job: toPublicJob(job), reconciled: false };
  }

  const reconciled = await reconcileJob(job);
  return { job: toPublicJob(reconciled), reconciled: true };
}

// Read the authoritative run state from Trigger.dev and fold it into the
// application job. A provider read failure is reported, never treated as a
// status change, so a temporarily unavailable Trigger.dev cannot corrupt the
// stored lifecycle.
async function reconcileJob(job) {
  let run;
  try {
    run = await runs.retrieve(job.runId);
  } catch (error) {
    console.warn("Failed to retrieve background job run:", error?.message);
    return job;
  }

  const runStatus = run?.status ?? null;
  const appStatus = resolveAppStatus(job.status, runStatus);
  const errorMessage =
    appStatus === "FAILED" ? sanitizeError(run?.error?.message ?? run?.error) : null;

  const updated = await applyRunState({
    jobId: job.id,
    runStatus,
    error: errorMessage,
  });

  return updated ?? job;
}

export async function listBackgroundJobs(userId, { limit, cursor, status } = {}) {
  return listJobsForUser(userId, { limit, cursor, status });
}

// Cancel one of the authenticated user's own active jobs. Only attempted when
// the run id is known, because a cancellation the application cannot confirm is
// worse than no cancellation at all.
export async function cancelBackgroundJob({ userId, jobId }) {
  assertNonEmptyString(jobId, "jobId");

  const job = await findJobForUser(jobId, userId);
  if (!job) {
    throw httpError(404, "Job not found.");
  }

  if (!isCancellableStatus(job.status)) {
    return { job: toPublicJob(job), cancelled: false };
  }

  // A job parked on an approval has no live Trigger run (its run ended
  // normally on purpose), so cancellation happens locally — and its pending
  // approval must die with it, otherwise answering the card later could try to
  // resume a cancelled job.
  if (job.status === "WAITING_FOR_USER") {
    await cancelPendingApprovals({
      aiJobId: job.id,
      reason: "The job was cancelled.",
    });
    const cancelled = await finishJob({
      jobId: job.id,
      status: "CANCELLED",
      runStatus: "CANCELED",
    });
    return { job: toPublicJob(cancelled), cancelled: true };
  }

  assertConfigured();

  if (!job.runId) {
    throw httpError(409, "The job has not been dispatched yet and cannot be cancelled.");
  }

  try {
    await runs.cancel(job.runId);
  } catch (error) {
    // Cancelling a run that already finished is a normal race. Reconcile
    // instead of guessing, and surface a real provider failure as such.
    const reconciled = await reconcileJob(job);
    if (!isActiveStatus(reconciled.status)) {
      return { job: toPublicJob(reconciled), cancelled: false };
    }
    console.error("Failed to cancel background job run:", error?.message);
    throw httpError(502, "Failed to cancel the background job.");
  }

  // The cancellation was accepted. The run may still be tearing down, so the
  // stored run status is recorded as CANCELED and the next read reconciles.
  // Any approval the run parked on (a race with an answering pause) is dropped
  // for the same reason as above.
  await cancelPendingApprovals({
    aiJobId: job.id,
    reason: "The job was cancelled.",
  });

  const cancelled = await finishJob({
    jobId: job.id,
    status: "CANCELLED",
    runStatus: "CANCELED",
  });

  return { job: toPublicJob(cancelled), cancelled: true };
}
