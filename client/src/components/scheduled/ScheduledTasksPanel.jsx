import { useMemo, useState } from "react";
import { AlertCircle, CalendarClock, Info, Plus, RefreshCw } from "lucide-react";
import Card from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import Modal from "../ui/Modal.jsx";
import ScheduledTaskList from "./ScheduledTaskList.jsx";
import ScheduledTaskForm from "./ScheduledTaskForm.jsx";
import { useAsync } from "../../hooks/useAsync.js";
import { usePolling } from "../../hooks/usePolling.js";
import { listChats } from "../../services/chatService.js";
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  runScheduledTaskNow,
  updateScheduledTask,
} from "../../services/scheduledTaskService.js";

// Scheduled teammate runs (ROADMAP.md Phase D).
//
// A task dispatches the same durable background job a manual run does, so the
// runs themselves are inspected on the Jobs tab: this panel only owns the
// schedule (what, when, whether it is on) and its bookkeeping.
export default function ScheduledTasksPanel({ onViewJobs }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const tasks = useAsync(() => listScheduledTasks({ limit: 50 }), []);
  const chats = useAsync(() => listChats(), []);

  const chatsById = useMemo(
    () => Object.fromEntries((chats.data ?? []).map((chat) => [chat.id, chat])),
    [chats.data],
  );

  // Keep nextRunAt, status and lastError current while this panel is open, so a
  // task that just fired shows its run without a manual refresh.
  usePolling(
    async () => {
      try {
        await tasks.refetch({ silent: true });
      } catch {
        // Transient; the next tick retries.
      }
    },
    { active: true, intervalMs: 15000 },
  );

  async function create(payload) {
    setCreating(true);
    setCreateError(null);
    try {
      const task = await createScheduledTask(payload);
      setCreateOpen(false);
      setNotice(
        task?.nextRunAt
          ? `Scheduled. The sweep picks it up within a minute of ${new Date(
              task.nextRunAt,
            ).toLocaleString()}.`
          : "Scheduled.",
      );
      await tasks.refetch({ silent: true });
    } catch (error) {
      setCreateError(error?.message ?? "Could not schedule the task.");
    } finally {
      setCreating(false);
    }
  }

  async function runNow(task) {
    setRunningId(task.id);
    setActionError(null);
    setNotice(null);
    try {
      const result = await runScheduledTaskNow(task.id);
      setNotice(
        `Started a run for "${task.goal.slice(0, 40)}…". It appears on the Jobs tab as ${
          result?.jobId ? result.jobId.slice(0, 10) : "a new job"
        }.`,
      );
      await tasks.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not start the run.");
    } finally {
      setRunningId(null);
    }
  }

  async function togglePause(task) {
    setTogglingId(task.id);
    setActionError(null);
    try {
      await updateScheduledTask(task.id, {
        status: task.status === "PAUSED" ? "ACTIVE" : "PAUSED",
      });
      await tasks.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not change the task.");
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(task) {
    const confirmed = window.confirm(
      `Delete this scheduled task?\n\n"${task.goal.slice(0, 120)}"\n\nIf it already started a run, that run is cancelled.`,
    );
    if (!confirmed) return;

    setDeletingId(task.id);
    setActionError(null);
    try {
      const result = await deleteScheduledTask(task.id);
      setNotice(
        result?.cancelledRun
          ? "Task deleted, and the run it had started was cancelled."
          : "Task deleted.",
      );
      await tasks.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not delete the task.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-success px-3 py-2 text-[11px] text-success-ink">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
          {onViewJobs && (
            <button
              type="button"
              onClick={onViewJobs}
              className="font-medium underline underline-offset-2"
            >
              View the runs
            </button>
          )}
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <button type="button" onClick={() => setActionError(null)} className="text-left">
            {actionError}
          </button>
        </div>
      )}

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <p className="text-xs font-semibold text-ink">
            Scheduled tasks
            <span className="ml-2 font-normal text-[11px] text-ink-muted">
              {tasks.data?.tasks?.length ? `${tasks.data.tasks.length} shown` : ""}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              onClick={() => tasks.refetch()}
              loading={tasks.loading}
            >
              Refresh
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
              New task
            </Button>
          </div>
        </div>

        <div className="p-4">
          <ScheduledTaskList
            tasks={tasks.data?.tasks ?? []}
            loading={tasks.loading}
            error={tasks.error}
            chatsById={chatsById}
            runningId={runningId}
            togglingId={togglingId}
            deletingId={deletingId}
            onRunNow={runNow}
            onTogglePause={togglePause}
            onDelete={remove}
            onCreate={() => setCreateOpen(true)}
            emptyDescription="Schedule a teammate to run something later — a one-off check, or a task that repeats."
            emptyNote="Scheduled runs are dispatched by the scheduled-task-sweep task on Trigger.dev and executed as ordinary background jobs."
          />
        </div>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <p>
          A due slot dispatches the same job a manual background run uses, so approvals pause it,
          step budgets bound it, and results land in the linked chat. Slots are idempotent: a
          repeated sweep cannot start the same run twice. Missed slots are skipped rather than
          queued, and a failed dispatch stays due and is retried on the next sweep.
        </p>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Schedule a teammate run"
      >
        <ScheduledTaskForm
          chats={chats.data ?? []}
          onSubmit={create}
          busy={creating}
          error={createError}
        />
      </Modal>
    </div>
  );
}
