import { useMemo, useState } from "react";
import { RefreshCw, Users, Wrench } from "lucide-react";
import ToolExecutionCard from "./ToolExecutionCard.jsx";
import HandoffCard from "./HandoffCard.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import Spinner from "../ui/Spinner.jsx";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "tools", label: "Tool calls" },
  { id: "handoffs", label: "Handoffs" },
];

// One chronological timeline of real backend records: persisted tool executions
// and teammate handoffs. Both come from read-only endpoints, so this component
// never invents activity.
export default function ActivityFeed({
  executions = [],
  handoffs = [],
  loading = false,
  error = null,
  onRefresh,
  emptyTitle = "No activity yet",
  emptyDescription,
  emptyNote,
  showFilters = true,
  limit,
  compactHandoffs = false,
}) {
  const [filter, setFilter] = useState("all");

  const items = useMemo(() => {
    const merged = [
      ...executions.map((execution) => ({
        kind: "tool",
        key: `tool-${execution.id}`,
        at: execution.startedAt ?? execution.createdAt,
        data: execution,
      })),
      ...handoffs.map((handoff) => ({
        kind: "handoff",
        key: `handoff-${handoff.id}`,
        at: handoff.startedAt ?? handoff.createdAt,
        data: handoff,
      })),
    ];

    merged.sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));

    const filtered =
      filter === "all"
        ? merged
        : merged.filter((item) => (filter === "tools" ? item.kind === "tool" : item.kind === "handoff"));

    return limit ? filtered.slice(0, limit) : filtered;
  }, [executions, handoffs, filter, limit]);

  const toolCount = executions.length;
  const handoffCount = handoffs.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {showFilters &&
            FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                className={[
                  "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filter === entry.id
                    ? "bg-primary-soft text-primary-strong"
                    : "text-ink-muted hover:bg-sidebar hover:text-ink",
                ].join(" ")}
              >
                {entry.label}
              </button>
            ))}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <Wrench className="size-3" aria-hidden="true" />
            {toolCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" aria-hidden="true" />
            {handoffCount}
          </span>
          {onRefresh && (
            <button
              type="button"
              onClick={() => onRefresh()}
              className="grid size-6 place-items-center rounded-md transition-colors hover:bg-sidebar hover:text-ink"
              aria-label="Refresh activity"
              title="Refresh activity"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-slim">
        {loading && items.length === 0 ? (
          <div className="grid h-40 place-items-center">
            <Spinner label="Loading activity…" />
          </div>
        ) : error ? (
          <EmptyState
            icon={RefreshCw}
            title="Could not load activity"
            description={error.message}
            note="Activity comes from GET /api/tool-executions/:chatId and GET /api/handoffs/:chatId."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            note={emptyNote}
          />
        ) : (
          <ul className="space-y-2">
            {items.map((item) =>
              item.kind === "tool" ? (
                <ToolExecutionCard key={item.key} execution={item.data} />
              ) : (
                <HandoffCard key={item.key} handoff={item.data} compact={compactHandoffs} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
