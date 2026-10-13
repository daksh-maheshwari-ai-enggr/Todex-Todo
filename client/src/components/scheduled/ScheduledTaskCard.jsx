import { Link } from "react-router-dom";
import { Ban, CalendarClock, Play, Repeat, Timer } from "lucide-react";
import { StatusBadge } from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import { scheduledTaskStatus } from "../../utils/status.js";
import { formatDateTime, formatRelativeTime, truncate } from "../../utils/format.js";

// One scheduled task. Everything shown is what the server stored: the cadence,
// the next due instant, the last run and why it failed when it did.
export default function ScheduledTaskCard({
  task,
  onRunNow,
  onTogglePause,
  onDelete,
  runningId = null,
  togglingId = null,
  deletingId = null,
  chatTitle = null,
}) {
  const status = scheduledTaskStatus(task.status);
  const repeating = Boolean(task.intervalMinutes);
  const paused = task.status === "PAUSED";

  return (
    <li className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-strong">
          {repeating ? (
            <Repeat className="size-3.5" aria-hidden="true" />
          ) : (
            <CalendarClock className="size-3.5" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[11px] text-ink-muted">
              {repeating
                ? `every ${formatInterval(task.intervalMinutes)}`
                : task.runAt
                  ? `once at ${formatDateTime(task.runAt)}`
                  : "once"}
            </span>
            {task.runCount > 0 && (
              <span className="text-[11px] text-ink-muted">· {task.runCount} runs</span>
            )}
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-ink">{truncate(task.goal, 240)}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
            {task.status === "ACTIVE" && task.nextRunAt && (
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3" aria-hidden="true" />
                next run {formatRelativeTime(task.nextRunAt)}
              </span>
            )}
            {paused && <span>Paused — no runs until you resume it.</span>}
            {task.status === "COMPLETED" && <span>Finished; it will not run again.</span>}
            {task.lastRunAt && <span>last run {formatRelativeTime(task.lastRunAt)}</span>}
            {chatTitle && <span>in {truncate(chatTitle, 40)}</span>}
          </div>

          {task.lastError && (
            <p className="mt-1.5 rounded-lg border border-error-ink/20 bg-error px-2.5 py-1.5 text-[11px] text-error-ink">
              Last dispatch failed: {truncate(task.lastError, 200)} — the slot stays due and is
              retried on the next sweep.
            </p>
          )}

          {task.lastJobId && (
            <p className="mt-1.5 text-[11px] text-ink-muted">
              Last run recorded as job{" "}
              <span className="font-mono text-[10px]">{task.lastJobId.slice(0, 10)}…</span> — its
              result and approvals are in the chat.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            icon={Play}
            loading={runningId === task.id}
            disabled={paused || runningId === task.id}
            onClick={() => onRunNow?.(task)}
            title="Start one run now without changing the schedule"
          >
            Run now
          </Button>

          {task.status !== "COMPLETED" && (
            <Button
              size="sm"
              variant="ghost"
              loading={togglingId === task.id}
              disabled={togglingId === task.id}
              onClick={() => onTogglePause?.(task)}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
          )}

          <Button
            size="sm"
            variant="danger"
            icon={Ban}
            loading={deletingId === task.id}
            disabled={deletingId === task.id}
            onClick={() => onDelete?.(task)}
            title="Remove the schedule and cancel the run it started"
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="border-t border-line px-4 py-2">
        <Link
          to={`/chat/${task.chatId}`}
          className="text-[11px] font-medium text-primary-strong hover:underline"
        >
          Open the chat
        </Link>
      </div>
    </li>
  );
}

function formatInterval(minutes) {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "day" : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "hour" : `${hours} hours`;
  }
  return minutes === 1 ? "minute" : `${minutes} minutes`;
}
