import { schedules } from "@trigger.dev/sdk";
import { config } from "../server/config.js";
import { runDueScheduledTasks } from "../server/scheduledTasks.js";

// The scheduled-task sweep (ROADMAP.md Phase D).
//
// This task owns exactly one job: on its own cron, ask which scheduled tasks are
// due and let the service dispatch them. The service does the dispatching (it
// reuses the manual background-job path, so approval pauses and step budgets are
// identical), which keeps this file free of business logic.
//
// The cron lives here rather than in a hand-rolled scheduler: Trigger.dev
// computes the schedule, so no cron-parsing dependency is needed and missed
// invocations are handled by the provider instead of by us.
//
// Resolution note: one minute is the finest granularity a cron schedule can
// express, so a task scheduled for 15:00:30 runs on the next sweep. Dispatch
// itself is exact (the slot is an instant), which is what keeps the idempotency
// key stable.
export const scheduledTaskSweep = schedules.task({
  id: "scheduled-task-sweep",
  description:
    "Dispatches teammate runs whose scheduled time has arrived, reusing the background-job path.",
  cron: "* * * * *",
  maxDuration: 120,

  run: async () => {
    const { checked, results } = await runDueScheduledTasks({
      limit: config.scheduledTasks.sweepBatchSize,
    });

    if (checked === 0) {
      return { checked: 0, dispatched: 0, failed: 0, results: [] };
    }

    const dispatched = results.filter((result) => result.ok).length;
    const failed = results.length - dispatched;

    // Log the failures with their reasons: a task that cannot dispatch must be
    // visible in the run history, not just in the database.
    for (const result of results) {
      if (!result.ok) {
        console.warn(`[scheduled-task] ${result.taskId} failed to dispatch: ${result.error}`);
      }
    }

    return { checked, dispatched, failed, results };
  },
});

export default scheduledTaskSweep;
