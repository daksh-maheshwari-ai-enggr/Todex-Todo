import { useState } from "react";
import { Ban, ChevronDown, ChevronRight, Clock, Hash, RefreshCw, RotateCw } from "lucide-react";
import { StatusBadge } from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import CodeBlock from "../ui/CodeBlock.jsx";
import { jobStatus, isJobActive } from "../../utils/status.js";
import { formatDateTime, formatDuration, formatRelativeTime, truncate } from "../../utils/format.js";

// One durable background job. Status, result and error are exactly what the
// server stored (and, while active, what it reconciled from Trigger.dev).
export default function JobCard({ job, onCancel, onRefresh, cancelling = false, refreshing = false }) {
  const [open, setOpen] = useState(false);

  const status = jobStatus(job.status);
  const active = isJobActive(job.status);

  const duration =
    job.startedAt && job.completedAt
      ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
      : null;

  return (
    <li className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-label={open ? "Hide job details" : "Show job details"}
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-sidebar hover:text-ink"
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <span className="font-mono text-[10px] text-ink-muted">
              <Hash className="mr-0.5 inline size-2.5" aria-hidden="true" />
              {job.id.slice(0, 10)}
            </span>
            <span className="text-[11px] text-ink-muted">
              attempt {job.attemptCount}/{job.maxAttempts}
            </span>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-ink">
            {open ? job.message : truncate(job.message, 160)}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
            <span>created {formatRelativeTime(job.createdAt)}</span>
            {job.startedAt && <span>started {formatRelativeTime(job.startedAt)}</span>}
            {duration != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                {formatDuration(duration)}
              </span>
            )}
          </div>

          {!open && job.status === "FAILED" && job.error && (
            <p className="mt-1.5 truncate text-[11px] text-error-ink">{truncate(job.error, 140)}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {onRefresh && (
            <Button
              size="sm"
              variant="ghost"
              icon={RefreshCw}
              onClick={() => onRefresh(job)}
              loading={refreshing}
              title="Re-check status with Trigger.dev"
            >
              <span className="sr-only">Refresh</span>
            </Button>
          )}

          {active && onCancel && (
            <Button
              size="sm"
              variant="danger"
              icon={Ban}
              onClick={() => onCancel(job)}
              loading={cancelling}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="animate-fade-in space-y-3 border-t border-line px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
            <Detail label="Chat" value={job.chatId} mono />
            <Detail label="Teammate" value={job.botId} mono />
            <Detail label="Created" value={formatDateTime(job.createdAt)} />
            <Detail label="Started" value={job.startedAt ? formatDateTime(job.startedAt) : "—"} />
            <Detail label="Completed" value={job.completedAt ? formatDateTime(job.completedAt) : "—"} />
            <Detail
              label="Assistant message"
              value={job.assistantMessageId ? `${job.assistantMessageId.slice(0, 10)}…` : "—"}
              mono
            />
          </dl>

          {job.result && <CodeBlock label="Result" value={job.result} tone="success" />}
          {job.error && <CodeBlock label="Error" value={job.error} tone="error" maxHeight="10rem" />}

          {active && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
              <RotateCw className="size-3" aria-hidden="true" />
              Still running. Status refreshes from Trigger.dev while this page is open.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={["truncate text-ink", mono ? "font-mono text-[10px]" : ""].join(" ")} title={value}>
        {value || "—"}
      </dd>
    </div>
  );
}
