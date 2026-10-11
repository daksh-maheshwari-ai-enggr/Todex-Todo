import { useState } from "react";
import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import { StatusBadge } from "../ui/Badge.jsx";
import CodeBlock from "../ui/CodeBlock.jsx";
import { executionStatus } from "../../utils/status.js";
import { toolMeta } from "../../utils/toolMeta.js";
import { formatDuration, formatRelativeTime, parseMaybeJson, truncate } from "../../utils/format.js";

// Renders one persisted tool execution exactly as recorded by the backend:
// tool name, status, timing, arguments and bounded result or error. Nothing is
// simulated.
export default function ToolExecutionCard({ execution, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const meta = toolMeta(execution.toolName);
  const Icon = meta.icon;
  const status = executionStatus(execution.status);
  const args = parseMaybeJson(execution.args);
  const result = parseMaybeJson(execution.result);
  const startedAt = execution.startedAt ?? execution.createdAt;

  return (
    <li className="overflow-hidden rounded-card border border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-sidebar/50"
      >
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-strong">
          <Icon className="size-3.5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-ink">{execution.toolName}</span>
            <StatusBadge status={status} />
            <span className="text-[11px] text-ink-muted">{meta.label}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
            <span>{formatRelativeTime(startedAt)}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              {formatDuration(execution.durationMs)}
            </span>
            {execution.toolCallId && (
              <span className="font-mono opacity-70">{truncate(execution.toolCallId, 24)}</span>
            )}
          </div>

          {!open && execution.error && (
            <p className="mt-1.5 truncate text-[11px] text-error-ink">
              {truncate(execution.error, 140)}
            </p>
          )}
        </div>

        {open ? (
          <ChevronDown className="mt-1 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-1 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="animate-fade-in space-y-3 border-t border-line px-3.5 py-3">
          <CodeBlock
            label="Arguments"
            value={args ?? (execution.args || "")}
            maxHeight="12rem"
          />

          {execution.error ? (
            <CodeBlock label="Error" value={execution.error} tone="error" maxHeight="10rem" />
          ) : (
            <CodeBlock
              label="Result"
              value={result ?? (execution.result || "")}
              tone={execution.status === "SUCCEEDED" ? "success" : "default"}
              maxHeight="14rem"
            />
          )}
        </div>
      )}
    </li>
  );
}
