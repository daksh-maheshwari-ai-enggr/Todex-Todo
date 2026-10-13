import { CalendarClock } from "lucide-react";
import ScheduledTaskCard from "./ScheduledTaskCard.jsx";
import Button from "../ui/Button.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import Spinner from "../ui/Spinner.jsx";

export default function ScheduledTaskList({
  tasks = [],
  loading = false,
  error = null,
  chatsById = {},
  runningId = null,
  togglingId = null,
  deletingId = null,
  onRunNow,
  onTogglePause,
  onDelete,
  onCreate,
  emptyTitle = "Nothing scheduled yet",
  emptyDescription,
  emptyNote,
}) {
  if (loading && tasks.length === 0) {
    return (
      <div className="grid h-52 place-items-center">
        <Spinner label="Loading scheduled tasks…" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Could not load scheduled tasks"
        description={error.message}
        note="Scheduled tasks come from GET /api/scheduled-tasks."
      />
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={CalendarClock}
          title={emptyTitle}
          description={emptyDescription}
          note={emptyNote}
        />
        {onCreate && (
          <div className="flex justify-center">
            <Button size="sm" onClick={onCreate}>
              Schedule a task
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {tasks.map((task) => (
        <ScheduledTaskCard
          key={task.id}
          task={task}
          chatTitle={chatsById[task.chatId]?.title ?? null}
          onRunNow={onRunNow}
          onTogglePause={onTogglePause}
          onDelete={onDelete}
          runningId={runningId}
          togglingId={togglingId}
          deletingId={deletingId}
        />
      ))}
    </ul>
  );
}
