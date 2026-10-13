import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { resolveOwnedContext, startBackgroundJob, cancelBackgroundJob } from "./backgroundJobs.js";
import { sanitizeError } from "./jobs.js";

// Scheduled / proactive teammate runs (ROADMAP.md Phase D).
//
// A task is a standing instruction: run once at an instant, or every N minutes.
// It never runs the agent itself — a due slot dispatches the same background job
// a manual run uses, so the whole Phase A/B machinery (pause for approval, step
// budget, crash-safe retry, results persisted as chat messages) is inherited
// rather than reimplemented.
//
// Two properties matter more than features here:
//   * `nextRunAt` is the slot AND the idempotency key. A sweep that fires twice,
//     or two sweeps racing, can only ever dispatch one run per slot.
//   * A slot stays due until its dispatch is *accepted*. A provider outage
//     therefore delays a run instead of silently skipping it, and there is no
//     catch-up burst: a repeating task resumes on the next slot from now.

const MAX_GOAL_LENGTH = 4000;
const MAX_ERROR_LENGTH = 2000;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// Bounds on a repeating cadence. One minute is the floor because that is the
// resolution of the sweep; 30 days is the ceiling on usefulness.
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 30 * 24 * 60;

const DEFAULT_SWEEP_BATCH = 10;

const STATUSES = ["ACTIVE", "PAUSED", "COMPLETED"];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function truncate(value, max) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : String(value);
  if (text.length === 0) return null;
  return text.length > max ? text.slice(0, max) : text;
}

// Public shape. Internal ids (user, bot secrets) are not included beyond the ids
// the client already holds.
export function toPublicScheduledTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    botId: task.botId,
    chatId: task.chatId,
    goal: task.goal,
    status: task.status,
    runAt: task.runAt,
    intervalMinutes: task.intervalMinutes,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastJobId: task.lastJobId,
    lastError: task.lastError,
    runCount: task.runCount,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function parseRunAt(value, { mustBeFuture = true } = {}) {
  if (value == null) return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw httpError(400, "runAt must be an ISO date string.");
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, "runAt is not a valid date.");
  }

  if (mustBeFuture && date.getTime() <= Date.now()) {
    throw httpError(400, "runAt must be in the future.");
  }

  return date;
}

function parseIntervalMinutes(value) {
  if (value == null) return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    throw httpError(400, "intervalMinutes must be a whole number of minutes.");
  }
  if (minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
    throw httpError(
      400,
      `intervalMinutes must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`,
    );
  }
  return minutes;
}

function parseGoal(value) {
  const goal = typeof value === "string" ? value.trim() : "";
  if (!goal) {
    throw httpError(400, "goal is required and must be a non-empty string.");
  }
  if (goal.length > MAX_GOAL_LENGTH) {
    throw httpError(400, `goal exceeds the maximum length of ${MAX_GOAL_LENGTH} characters.`);
  }
  return goal;
}

// The first slot of a schedule. A repeating task may start at a specific instant
// (runAt + intervalMinutes) or simply interval minutes from now.
function firstSlot({ runAt, intervalMinutes }) {
  if (runAt) return runAt;
  return new Date(Date.now() + intervalMinutes * 60_000);
}

// The slot after a run that was accepted. Missed slots are skipped rather than
// queued: a task that was due an hour ago runs once, not sixty times.
function nextSlotAfter({ runAt, intervalMinutes }, slot) {
  if (!intervalMinutes) return null;
  const from = Math.max(Date.now(), slot ? slot.getTime() : 0);
  return new Date(from + intervalMinutes * 60_000);
}

// Create a scheduled task. Ownership of the teammate and chat is enforced by the
// same resolver the manual background-job path uses, before any row exists.
export async function createScheduledTask({
  userId,
  botId,
  chatId,
  goal,
  runAt = null,
  intervalMinutes = null,
}) {
  const text = parseGoal(goal);

  if (runAt == null && intervalMinutes == null) {
    throw httpError(400, "A schedule requires runAt or intervalMinutes.");
  }

  const parsedRunAt = parseRunAt(runAt);
  const parsedInterval = parseIntervalMinutes(intervalMinutes);

  if (!parsedRunAt && !parsedInterval) {
    throw httpError(400, "A schedule requires runAt or intervalMinutes.");
  }

  await resolveOwnedContext({ userId, botId, chatId });

  const task = await prisma.scheduledTask.create({
    data: {
      userId,
      botId,
      chatId,
      goal: text,
      runAt: parsedRunAt,
      intervalMinutes: parsedInterval,
      nextRunAt: firstSlot({ runAt: parsedRunAt, intervalMinutes: parsedInterval }),
      status: "ACTIVE",
    },
  });

  return toPublicScheduledTask(task);
}

// Load one of the caller's own tasks. Null covers both "missing" and "not
// yours", so a task id can never be probed.
export async function findScheduledTaskForUser(taskId, userId) {
  if (!taskId || typeof taskId !== "string" || !userId) return null;
  return prisma.scheduledTask.findFirst({ where: { id: taskId, userId } });
}

async function requireOwnedTask(taskId, userId) {
  const task = await findScheduledTaskForUser(taskId, userId);
  if (!task) throw httpError(404, "Scheduled task not found.");
  return task;
}

// List the caller's own tasks, newest first, with a bounded page and optional
// status filter.
export async function listScheduledTasks(userId, { limit, cursor, status } = {}) {
  const parsedLimit = Number(limit);
  const take = Math.min(
    Math.max(1, Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const where = { userId };
  if (status) {
    const normalized = String(status).toUpperCase();
    if (!STATUSES.includes(normalized)) {
      throw httpError(400, "Unknown scheduled task status filter.");
    }
    where.status = normalized;
  }

  const tasks = await prisma.scheduledTask.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = tasks.length > take;
  const page = hasMore ? tasks.slice(0, take) : tasks;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { tasks: page.map(toPublicScheduledTask), nextCursor };
}

export async function getScheduledTask({ taskId, userId }) {
  const task = await requireOwnedTask(taskId, userId);
  return toPublicScheduledTask(task);
}

// Change a task's schedule or state.
//
//   status: "PAUSED" stops it firing (the slot is kept for a later resume);
//   status: "ACTIVE" re-arms it (a repeating task starts a fresh cadence, a
//           one-shot fires on the next sweep);
//   runAt / intervalMinutes replace the schedule. Supplying one clears the
//   other, because a task is either one-shot or repeating, never both.
export async function updateScheduledTask({ taskId, userId, patch = {} }) {
  const task = await requireOwnedTask(taskId, userId);
  const data = {};

  if (patch.goal !== undefined) {
    data.goal = parseGoal(patch.goal);
  }

  const reschedules = patch.runAt !== undefined || patch.intervalMinutes !== undefined;

  if (reschedules) {
    const wantsInterval = patch.intervalMinutes != null;
    const wantsRunAt = patch.runAt != null;

    if (!wantsInterval && !wantsRunAt) {
      throw httpError(400, "A reschedule requires runAt or intervalMinutes.");
    }

    const runAt = wantsRunAt ? parseRunAt(patch.runAt) : null;
    const intervalMinutes = wantsInterval
      ? parseIntervalMinutes(patch.intervalMinutes)
      : null;

    data.runAt = runAt;
    data.intervalMinutes = intervalMinutes;
    data.nextRunAt = firstSlot({ runAt, intervalMinutes });
    // A schedule change implies the task should be running.
    data.status = "ACTIVE";
    data.lastError = null;
  }

  if (!reschedules && patch.status !== undefined) {
    const status = String(patch.status).toUpperCase();
    if (!STATUSES.includes(status)) {
      throw httpError(400, "status must be ACTIVE, PAUSED or COMPLETED.");
    }

    data.status = status;

    if (status === "ACTIVE") {
      const overdue = !task.nextRunAt || task.nextRunAt.getTime() <= Date.now();
      if (overdue) {
        data.nextRunAt = task.intervalMinutes
          ? new Date(Date.now() + task.intervalMinutes * 60_000)
          : new Date();
      }
      data.lastError = null;
    }
  }

  if (Object.keys(data).length === 0) {
    return toPublicScheduledTask(task);
  }

  const updated = await prisma.scheduledTask.update({ where: { id: task.id }, data });
  return toPublicScheduledTask(updated);
}

// Delete a task. Any run it already dispatched is cancelled first, so deleting a
// schedule can never leave an orphan run working on a goal nobody asked for.
export async function deleteScheduledTask({ taskId, userId }) {
  const task = await requireOwnedTask(taskId, userId);

  let cancelledRun = false;
  if (task.lastJobId) {
    try {
      const { cancelled } = await cancelBackgroundJob({ userId, jobId: task.lastJobId });
      cancelledRun = Boolean(cancelled);
    } catch (error) {
      // The run (or its chat) is already gone: nothing left to cancel.
      if (error?.status !== 404) throw error;
    }
  }

  await prisma.scheduledTask.delete({ where: { id: task.id } });
  return { deleted: true, taskId: task.id, cancelledRun };
}

// Record the outcome of one dispatch. A task deleted mid-sweep is not an error:
// there is simply nothing left to write.
async function recordRun(taskId, data) {
  try {
    return await prisma.scheduledTask.update({ where: { id: taskId }, data });
  } catch (error) {
    if (error?.code === "P2025") return null;
    throw error;
  }
}

// Dispatch one slot of a task. `slot` is the due instant and the idempotency
// key; a slot that was already accepted (a retried sweep, or a race) returns the
// job that exists instead of starting a second run.
async function dispatchSlot(task, slot, { advance = true } = {}) {
  const idempotencyKey = `scheduled:${task.id}:${slot.toISOString()}`;

  try {
    const { job, deduplicated } = await startBackgroundJob({
      userId: task.userId,
      botId: task.botId,
      chatId: task.chatId,
      message: task.goal,
      idempotencyKey,
    });

    const data = {
      lastRunAt: new Date(),
      lastJobId: job.id,
      lastError: null,
    };

    if (!deduplicated) {
      data.runCount = { increment: 1 };
    }

    if (advance) {
      const next = nextSlotAfter(task, slot);
      if (next) {
        data.nextRunAt = next;
      } else {
        // One-shot: finished after this run.
        data.status = "COMPLETED";
        data.nextRunAt = null;
      }
    }

    const updated = await recordRun(task.id, data);

    return {
      taskId: task.id,
      ok: true,
      jobId: job.id,
      deduplicated,
      status: updated?.status ?? task.status,
      nextRunAt: updated?.nextRunAt ?? null,
    };
  } catch (error) {
    // The slot stays due: a failed dispatch is retried by the next sweep rather
    // than silently dropped, and the reason is kept visible on the task.
    await recordRun(task.id, { lastError: truncate(sanitizeError(error), MAX_ERROR_LENGTH) });

    return {
      taskId: task.id,
      ok: false,
      error: sanitizeError(error),
    };
  }
}

// Run one task immediately, without touching its schedule. `slot` is unique per
// call so each press of "Run now" starts a run, even for a one-shot task.
export async function runScheduledTaskNow({ taskId, userId }) {
  const task = await requireOwnedTask(taskId, userId);

  if (task.status === "PAUSED") {
    throw httpError(409, "This task is paused. Resume it before running it.");
  }

  const result = await dispatchSlot(task, new Date(), { advance: false });
  if (!result.ok) {
    throw httpError(502, result.error ?? "Failed to start the scheduled run.");
  }

  return { taskId: task.id, jobId: result.jobId, deduplicated: result.deduplicated };
}

// The sweep. Every due, active task gets one dispatch attempt, oldest slot
// first, bounded per pass. Returns one result per task for the caller's logs.
export async function runDueScheduledTasks({ now = new Date(), limit } = {}) {
  const parsedLimit = Number(limit);
  const take = Math.min(
    Math.max(1, Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_SWEEP_BATCH),
    MAX_LIMIT,
  );

  const due = await prisma.scheduledTask.findMany({
    where: { status: "ACTIVE", nextRunAt: { not: null, lte: now } },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take,
  });

  const results = [];
  for (const task of due) {
    results.push(await dispatchSlot(task, task.nextRunAt));
  }

  return { checked: due.length, results };
}

export const SCHEDULED_TASK_LIMITS = {
  MAX_GOAL_LENGTH,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  sweepBatch: config.scheduledTasks.sweepBatchSize,
};
