import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCheck,
  Eraser,
  Loader2,
  Play,
  Radio,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import Spinner from "../ui/Spinner.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import { toneClasses } from "../../utils/status.js";
import { formatRelativeTime, truncate } from "../../utils/format.js";
import { toolMeta } from "../../utils/toolMeta.js";

// Presentation-only mapping from a real backend event type to an icon and tone.
// The events themselves are produced by actual execution on the server; this
// table only decides how they look.
const EVENT_META = {
  "task.started": { icon: Play, tone: "idle", label: "Task" },
  "agent.thinking": { icon: Sparkles, tone: "idle", label: "Reasoning" },
  "tool.started": { icon: Wrench, tone: "running", label: "Tool" },
  "tool.finished": { icon: Check, tone: "success", label: "Tool" },
  "tool.failed": { icon: X, tone: "error", label: "Tool" },
  "handoff.started": { icon: ArrowRightLeft, tone: "running", label: "Handoff" },
  "handoff.finished": { icon: ArrowRightLeft, tone: "success", label: "Handoff" },
  "task.completed": { icon: CheckCheck, tone: "success", label: "Task" },
  "task.blocked": { icon: AlertTriangle, tone: "error", label: "Task" },
};

const CONNECTION = {
  idle: { label: "Idle", tone: "neutral" },
  connecting: { label: "Connecting", tone: "running" },
  open: { label: "Live", tone: "success" },
  reconnecting: { label: "Reconnecting", tone: "running" },
  closed: { label: "Closed", tone: "neutral" },
  error: { label: "Unavailable", tone: "error" },
};

// The live activity stream for one chat: every row is an event the backend
// emitted while actually executing the task.
export default function LiveActivityFeed({
  events = [],
  connection = "idle",
  error = null,
  taskState = "idle",
  onClear,
}) {
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const running = taskState === "running";

  // Follow the tail while work is in flight, without yanking the view if the
  // user has scrolled up to read something.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !running) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 120) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [events, running]);

  const connectionMeta = CONNECTION[connection] ?? CONNECTION.idle;
  const connectionClasses = toneClasses(connectionMeta.tone);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            connectionClasses.badge,
          ].join(" ")}
        >
          <Radio className="size-3" aria-hidden="true" />
          {connectionMeta.label}
        </span>

        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span>
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
          {running && (
            <Loader2 className="size-3 animate-spin-slow text-primary" aria-hidden="true" />
          )}
          {onClear && events.length > 0 && (
            <button
              type="button"
              onClick={() => onClear()}
              className="grid size-6 place-items-center rounded-md transition-colors hover:bg-sidebar hover:text-ink"
              aria-label="Clear live activity"
              title="Clear this view (does not delete the persisted history)"
            >
              <Eraser className="size-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scrollbar-slim">
        {error ? (
          <EmptyState
            icon={AlertTriangle}
            title="Live activity unavailable"
            description={error.message}
            note="Persisted tool calls and handoffs are still shown on the Activity tab."
          />
        ) : events.length === 0 ? (
          running || connection === "connecting" ? (
            <div className="grid h-40 place-items-center">
              <Spinner label="Waiting for the teammate's first action…" />
            </div>
          ) : (
            <EmptyState
              icon={Radio}
              title="No live activity yet"
              description="Send a task to a teammate and its real execution events appear here as they happen."
              note="Events are emitted by the backend while the agent runs. Nothing here is simulated."
            />
          )
        ) : (
          <ul className="space-y-2">
            {events.map((event) => (
              <LiveEventRow key={event.id} event={event} />
            ))}
            <li ref={bottomRef} aria-hidden="true" />
          </ul>
        )}
      </div>
    </div>
  );
}

function LiveEventRow({ event }) {
  const meta = EVENT_META[event.type] ?? { icon: Wrench, tone: "neutral", label: "Event" };
  const Icon = meta.icon;
  const tool = event.tool ? toolMeta(event.tool) : null;
  const classes = toneClasses(event.status === "failed" ? "error" : meta.tone);

  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-card px-3.5 py-2.5">
      <span
        className={[
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg",
          classes.badge,
        ].join(" ")}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink">
            {event.title ?? meta.label}
          </span>
          {event.tool && (
            <span className="rounded-full bg-line-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-ink-muted">
              {event.tool}
            </span>
          )}
          <span className="text-[10px] text-ink-muted">
            {formatRelativeTime(event.at)}
          </span>
        </div>

        {event.detail && (
          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-ink-muted">
            {truncate(event.detail, 400)}
          </p>
        )}

        {tool && !event.detail && (
          <p className="mt-1 text-[10px] text-ink-muted">{tool.label}</p>
        )}
      </div>
    </li>
  );
}
