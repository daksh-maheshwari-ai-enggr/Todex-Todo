import { Briefcase } from "lucide-react";
import JobCard from "./JobCard.jsx";
import Button from "../ui/Button.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import Spinner from "../ui/Spinner.jsx";

export default function JobList({
  jobs = [],
  loading = false,
  error = null,
  nextCursor = null,
  onLoadMore,
  loadingMore = false,
  onCancel,
  onRefresh,
  cancellingId = null,
  refreshingId = null,
  emptyTitle = "No background jobs yet",
  emptyDescription,
  emptyNote,
}) {
  if (loading && jobs.length === 0) {
    return (
      <div className="grid h-52 place-items-center">
        <Spinner label="Loading jobs…" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Could not load jobs"
        description={error.message}
        note="Jobs come from GET /api/jobs. They require TRIGGER_SECRET_KEY on the server."
      />
    );
  }

  if (jobs.length === 0) {
    return <EmptyState icon={Briefcase} title={emptyTitle} description={emptyDescription} note={emptyNote} />;
  }

  return (
    <div>
      <ul className="space-y-2.5">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onCancel={onCancel}
            onRefresh={onRefresh}
            cancelling={cancellingId === job.id}
            refreshing={refreshingId === job.id}
          />
        ))}
      </ul>

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => onLoadMore?.()} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
