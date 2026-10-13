import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  runScheduledTaskNow,
  updateScheduledTask,
} from "../scheduledTasks.js";

// Scheduled / proactive teammate runs (ROADMAP.md Phase D).
//
//   POST   /api/scheduled-tasks        schedule a run (one-shot or repeating)
//   GET    /api/scheduled-tasks        the caller's own tasks
//   GET    /api/scheduled-tasks/:id    one task
//   PATCH  /api/scheduled-tasks/:id    pause, resume or reschedule
//   DELETE /api/scheduled-tasks/:id    remove it (and cancel any run it started)
//   POST   /api/scheduled-tasks/:id/run        start one run now
//
// Ownership is enforced in the service for every operation; nothing here trusts
// a task id, teammate id or chat id from the browser.

const router = Router();

function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

router.post("/", requireAuth, async (req, res) => {
  const { botId, chatId, goal, runAt, intervalMinutes } = req.body || {};

  try {
    const task = await createScheduledTask({
      userId: req.user.id,
      botId,
      chatId,
      goal,
      runAt: runAt ?? null,
      intervalMinutes: intervalMinutes ?? null,
    });
    res.status(201).json({ task });
  } catch (error) {
    sendError(res, error, "Failed to schedule the task.");
  }
});

router.get("/", requireAuth, async (req, res) => {
  const { limit, cursor, status } = req.query || {};

  try {
    const { tasks, nextCursor } = await listScheduledTasks(req.user.id, {
      limit,
      cursor: typeof cursor === "string" ? cursor : undefined,
      status: typeof status === "string" ? status : undefined,
    });
    res.json({ tasks, nextCursor });
  } catch (error) {
    sendError(res, error, "Failed to fetch scheduled tasks.");
  }
});

router.get("/:taskId", requireAuth, async (req, res) => {
  const { taskId } = req.params;
  if (!taskId || typeof taskId !== "string") {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  try {
    const task = await getScheduledTask({ taskId, userId: req.user.id });
    res.json({ task });
  } catch (error) {
    sendError(res, error, "Failed to fetch the scheduled task.");
  }
});

router.patch("/:taskId", requireAuth, async (req, res) => {
  const { taskId } = req.params;
  if (!taskId || typeof taskId !== "string") {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  const { status, goal, runAt, intervalMinutes } = req.body || {};

  try {
    const task = await updateScheduledTask({
      taskId,
      userId: req.user.id,
      patch: {
        ...(status !== undefined ? { status } : {}),
        ...(goal !== undefined ? { goal } : {}),
        ...(runAt !== undefined ? { runAt } : {}),
        ...(intervalMinutes !== undefined ? { intervalMinutes } : {}),
      },
    });
    res.json({ task });
  } catch (error) {
    sendError(res, error, "Failed to update the scheduled task.");
  }
});

router.delete("/:taskId", requireAuth, async (req, res) => {
  const { taskId } = req.params;
  if (!taskId || typeof taskId !== "string") {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  try {
    const result = await deleteScheduledTask({ taskId, userId: req.user.id });
    res.json(result);
  } catch (error) {
    sendError(res, error, "Failed to delete the scheduled task.");
  }
});

router.post("/:taskId/run", requireAuth, async (req, res) => {
  const { taskId } = req.params;
  if (!taskId || typeof taskId !== "string") {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  try {
    const result = await runScheduledTaskNow({ taskId, userId: req.user.id });
    res.status(202).json(result);
  } catch (error) {
    sendError(res, error, "Failed to start the scheduled run.");
  }
});

export default router;
