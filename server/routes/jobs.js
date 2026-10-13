import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  cancelBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
  startBackgroundJob,
} from "../backgroundJobs.js";
import { listJobSteps } from "../jobs.js";

const router = Router();

// Map a service error to an HTTP response without leaking internals. A failed
// dispatch also returns the job it just recorded, so the client can see that
// nothing is silently queued.
function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.job ? { job: error.job } : {}),
    });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

// POST /api/jobs
// Start a durable background teammate turn. Records the job, dispatches it to
// Trigger.dev and returns the job immediately instead of waiting for the AI
// task. Every referenced resource is ownership-checked before a job is created.
router.post("/", requireAuth, async (req, res) => {
  const { botId, chatId, message, idempotencyKey } = req.body || {};

  try {
    const { job, deduplicated } = await startBackgroundJob({
      userId: req.user.id,
      botId,
      chatId,
      message,
      idempotencyKey,
    });

    // 202 when a new job was accepted, 200 when an identical request was
    // deduplicated onto the job already in flight.
    return res.status(deduplicated ? 200 : 202).json({ job, deduplicated });
  } catch (error) {
    sendError(res, error, "Failed to start background job.");
  }
});

// GET /api/jobs
// List the authenticated user's own jobs, newest first, bounded pagination.
router.get("/", requireAuth, async (req, res) => {
  const { limit, cursor, status } = req.query || {};

  try {
    const { jobs, nextCursor } = await listBackgroundJobs(req.user.id, {
      limit,
      cursor: typeof cursor === "string" ? cursor : undefined,
      status: typeof status === "string" ? status : undefined,
    });
    res.json({ jobs, nextCursor });
  } catch (error) {
    sendError(res, error, "Failed to fetch background jobs.");
  }
});

// GET /api/jobs/:jobId
// Status and bounded result for one of the authenticated user's own jobs.
router.get("/:jobId", requireAuth, async (req, res) => {
  const { jobId } = req.params;

  if (!jobId || typeof jobId !== "string") {
    return res.status(400).json({ error: "Invalid job ID." });
  }

  try {
    const { job, reconciled } = await getBackgroundJob({ userId: req.user.id, jobId });
    res.json({ job, reconciled });
  } catch (error) {
    sendError(res, error, "Failed to fetch background job.");
  }
});

// GET /api/jobs/:jobId/steps
// The recorded timeline of one job: the tool rounds it actually ran and the
// approvals it raised, oldest first. This is the durable record (ToolExecution
// + ApprovalRequest), not a live feed, so it reads the same after a restart.
router.get("/:jobId/steps", requireAuth, async (req, res) => {
  const { jobId } = req.params;

  if (!jobId || typeof jobId !== "string") {
    return res.status(400).json({ error: "Invalid job ID." });
  }

  try {
    const steps = await listJobSteps({ userId: req.user.id, jobId });
    res.json(steps);
  } catch (error) {
    sendError(res, error, "Failed to fetch the job's steps.");
  }
});

// POST /api/jobs/:jobId/cancel
// Request cancellation of one of the authenticated user's own active jobs.
router.post("/:jobId/cancel", requireAuth, async (req, res) => {
  const { jobId } = req.params;

  if (!jobId || typeof jobId !== "string") {
    return res.status(400).json({ error: "Invalid job ID." });
  }

  try {
    const { job, cancelled } = await cancelBackgroundJob({ userId: req.user.id, jobId });
    res.json({ job, cancelled });
  } catch (error) {
    sendError(res, error, "Failed to cancel background job.");
  }
});

export default router;
