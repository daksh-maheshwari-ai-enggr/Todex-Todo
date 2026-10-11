import { ArrowRightLeft, Clock, CornerDownRight } from "lucide-react";
import { StatusBadge } from "../ui/Badge.jsx";
import CodeBlock from "../ui/CodeBlock.jsx";
import Avatar from "../ui/Avatar.jsx";
import { executionStatus } from "../../utils/status.js";
import { formatDuration, formatRelativeTime } from "../../utils/format.js";

// One teammate-to-teammate delegation, as persisted by the backend handoff
// service. Read-only: handoffs are only ever created by server-side agent
// execution.
export default function HandoffCard({ handoff, compact = false }) {
  const status = executionStatus(handoff.status);
  const fromName = handoff.fromBot?.name ?? "Teammate";
  const toName = handoff.toBot?.name ?? "Teammate";

  const duration =
    handoff.startedAt && handoff.completedAt
      ? new Date(handoff.completedAt).getTime() - new Date(handoff.startedAt).getTime()
      : null;

  return (
    <li className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-strong">
          <ArrowRightLeft className="size-3.5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
              <Avatar seed={handoff.fromBot?.id} name={fromName} size="sm" className="ring-0" />
              {fromName}
              <CornerDownRight className="size-3 text-ink-muted" aria-hidden="true" />
              <Avatar seed={handoff.toBot?.id} name={toName} size="sm" className="ring-0" />
              {toName}
            </span>
            <StatusBadge status={status} />
            {handoff.depth > 0 && (
              <span className="rounded-full bg-line-soft px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                depth {handoff.depth}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
            <span>{formatRelativeTime(handoff.startedAt ?? handoff.createdAt)}</span>
            {duration != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" />
                {formatDuration(duration)}
              </span>
            )}
          </div>

          <p className="mt-2 rounded-lg border border-line bg-sidebar px-2.5 py-2 text-[11px] leading-relaxed text-ink">
            {handoff.task}
          </p>

          {!compact && (handoff.result || handoff.error) && (
            <div className="mt-2">
              {handoff.error ? (
                <CodeBlock label="Error" value={handoff.error} tone="error" maxHeight="10rem" />
              ) : (
                <CodeBlock
                  label="Result"
                  value={handoff.result}
                  tone="success"
                  maxHeight="14rem"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
