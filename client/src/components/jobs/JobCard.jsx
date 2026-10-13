import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Ban,
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  ListOrdered,
  PauseCircle,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import { StatusBadge } from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import CodeBlock from "../ui/CodeBlock.jsx";
import { executionStatus, isJobActive, jobStatus } from "../../utils/status.js";
import { getJobSteps } from "../../services/jobService.js";
import { formatDateTime, formatDuration, formatRelativeTime, truncate } from "../../utils/format.js";

// Approval steps carry their own lifecycle, which is wider than the tool
// execution lifecycle: a question is answered, an action is approved/rejected,
// and either can expire or be cancelled with its run.
const APPROVAL_STEP_STATUS = {
  PENDING: { label: "Waiting for you", tone: "running" },
  APPROVED: { label: "Answered", tone: "success" },
  REJECTED: { label: "Rejected", tone: "error" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

// One durable background job. Status, result and error are exactly what the
// server stored (and, while active, what it reconciled from Trigger.dev).
export default function JobCard({ job, onCancel, onRefresh, cancelling = false, refreshing = false }) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState(null);
  const [stepsError, setStepsError] = useState(null);

  const status = jobStatus(job.status);
  const active = isJobActive(job.status);
  const waiting = job.status === "WAITING_FOR_USER";

  const duration =
    job.startedAt && job.completedAt
      ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
      : null;

  // The step timeline is the durable ToolExecution/ApprovalRequest record for
  // this job, loaded on first expand instead of with every list row.
  async function toggle() {
    const next = !open;
    setOpen(next);

    if (!next || steps !== null || stepsError) return;
    try {
      const data = await getJobSteps(job.id);
      setSteps(data.steps ?? []);
    } catch (error) {
      setStepsError(error?.message ?? "Could not load the job's steps.");
    }
  }

  return (
    <li className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={toggle}
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
            {job.stepCount > 0 && (
              <span className="text-[11px] text-ink-muted">· {job.stepCount} steps</span>
            )}
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

      {waiting && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-running-ink/20 bg-running px-4 py-2.5 text-[11px] text-running-ink">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <PauseCircle className="size-3.5 shrink-0" aria-hidden="true" />
            ⏸ Waiting for you
          </span>
          <span>
            The run stopped to ask something
            {job.waitSince ? ` ${formatRelativeTime(job.waitSince)}` : ""}. Answering it in the
            chat continues the same run.
          </span>
          {job.chatId && (
            <Link
              to={`/chat/${job.chatId}`}
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
            >
              Open the chat
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}

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

          <StepTimeline
            steps={steps}
            error={stepsError}
            stepCount={job.stepCount}
            waitingApprovalId={job.waitingForApprovalId}
          />

          {active && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
              <RotateCw className="size-3" aria-hidden="true" />
              {waiting
                ? "Parked on your answer. The run continues once the approval is answered."
                : "Still running. Status refreshes from Trigger.dev while this page is open."}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

// The durable record of what the run actually did: every tool round it executed
// and every approval it raised, oldest first.
function StepTimeline({ steps, error, stepCount, waitingApprovalId }) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink">
        <ListOrdered className="size-3.5" aria-hidden="true" />
        Steps
        <span className="font-normal text-ink-muted">
          {stepCount ? `${stepCount} tool round${stepCount === 1 ? "" : "s"} counted` : ""}
        </span>
      </p>

      {error && <p className="mt-1.5 text-[11px] text-error-ink">{error}</p>}

      {steps === null && !error && (
        <p className="mt-1.5 text-[11px] text-ink-muted">Loading the recorded steps…</p>
      )}

      {steps !== null && steps.length === 0 && (
        <p className="mt-1.5 text-[11px] text-ink-muted">
          No tool rounds or approvals were recorded for this job yet.
        </p>
      )}

      {steps !== null && steps.length > 0 && (
        <ol className="mt-2 space-y-2">
          {steps.map((step, index) => (
            <li key={`${step.type}-${step.id}`} className="flex items-start gap-2">
              <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] text-ink-muted">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {step.type === "approval" ? (
                    <>
                      <StatusBadge
                        status={
                          APPROVAL_STEP_STATUS[step.status] ?? {
                            label: step.status,
                            tone: "neutral",
                          }
                        }
                      />
                      <span className="font-mono text-[10px] text-ink-muted">
                        {step.approvalKind?.toLowerCase() ?? "approval"}
                        {step.id === waitingApprovalId ? " · this job's pause" : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <StatusBadge status={executionStatus(step.status)} />
                      <span className="font-mono text-[10px] text-ink-muted">{step.toolName}</span>
                      {step.durationMs != null && (
                        <span className="text-[10px] text-ink-muted">
                          {formatDuration(step.durationMs)}
                        </span>
                      )}
                    </>
                  )}
                  <span className="text-[10px] text-ink-muted">{formatRelativeTime(step.at)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-muted">
                  {truncate(
                    step.type === "approval"
                      ? step.question
                      : step.error || step.result || "(no output recorded)",
                    400,
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
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
