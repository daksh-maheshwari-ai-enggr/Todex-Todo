import { task } from "@trigger.dev/sdk";
import { config } from "../server/config.js";
import { runAiJob } from "../server/jobRunner.js";
import { AI_JOB_TASK_ID, finishJob, isRetryableJobError, sanitizeError } from "../server/jobs.js";

// Trigger.dev task definition for durable background AI teammate turns.
//
// Keep this file thin: it owns retry/timeout policy and failure persistence
// only. The actual work lives in server/jobRunner.js, which reuses the existing
// chat orchestration and agent so there is exactly one agent loop.
//
// The payload is just `{ jobId }`. Trusted context and the bounded request text
// are loaded from the database by the runner, so nothing sensitive is ever
// serialized into a Trigger.dev payload.

async function persistFailure(jobId, error) {
  try {
    await finishJob({ jobId, status: "FAILED", error: sanitizeError(error) });
  } catch (persistError) {
    // A persistence failure here must not mask the original task failure.
    console.warn("Failed to record background job failure:", persistError?.message);
  }
}

export const aiTeammateJob = task({
  id: AI_JOB_TASK_ID,
  description:
    "Runs one durable AI teammate turn for a job recorded by the Todex-todo server.",

  // Retries are applied per attempt. Because the runner reuses the user message
  // saved by an earlier attempt and commits the assistant reply together with
  // the job's terminal state in one transaction, a retry cannot duplicate chat
  // messages or reset the handoff/tool budgets of a previous attempt.
  retry: {
    maxAttempts: config.triggerDev.maxAttempts,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },

  // Hard ceiling for a single run, including all retries' wall time per attempt.
  maxDuration: config.triggerDev.maxDurationSec,

  run: async (payload, { ctx }) => {
    const jobId = payload?.jobId;
    if (!jobId || typeof jobId !== "string") {
      // Nothing to persist and nothing to retry: a payload without a job id is
      // a programming error, not a transient failure.
      throw new Error("A background job payload must include a jobId.");
    }

    return runAiJob({
      jobId,
      attemptCount: ctx?.attempt?.number ?? null,
    });
  },

  // Called when the run function throws, before the retry policy is applied.
  // Non-retryable failures (invalid request, missing resources, cancellation
  // detected mid-turn) are persisted immediately and stop retrying. Everything
  // else (provider timeout, network failure, crash) is left to the retry policy.
  catchError: async ({ payload, error }) => {
    if (isRetryableJobError(error)) {
      return;
    }

    const jobId = payload?.jobId;
    if (jobId && typeof jobId === "string") {
      await persistFailure(jobId, error);
    }

    return { skipRetrying: true };
  },

  // Backstop for failures that never reach the catch above: the process dying,
  // an out-of-memory kill, or maxDuration being exceeded. This is the last
  // chance to make sure no job stays stuck in an active state.
  onFailure: async ({ payload, error }) => {
    const jobId = payload?.jobId;
    if (!jobId || typeof jobId !== "string") return;
    await persistFailure(jobId, error);
  },
});

export default aiTeammateJob;
