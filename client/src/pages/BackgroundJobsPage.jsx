import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Briefcase, Info, RefreshCw, Zap } from "lucide-react";
import Topbar from "../components/layout/Topbar.jsx";
import Card from "../components/ui/Card.jsx";
import Button, { buttonClass } from "../components/ui/Button.jsx";
import JobList from "../components/jobs/JobList.jsx";
import { cancelJob, getJob, listJobs } from "../services/jobService.js";
import { useAsync } from "../hooks/useAsync.js";
import { usePolling } from "../hooks/usePolling.js";
import { isJobActive } from "../utils/status.js";

const FILTERS = [
  { id: "", label: "All" },
  { id: "QUEUED", label: "Queued" },
  { id: "RUNNING", label: "Running" },
  { id: "SUCCEEDED", label: "Succeeded" },
  { id: "FAILED", label: "Failed" },
  { id: "CANCELLED", label: "Cancelled" },
];

export default function BackgroundJobsPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [pages, setPages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [refreshingId, setRefreshingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const first = useAsync(
    () => listJobs({ limit: 25, status: statusFilter || undefined }),
    [statusFilter],
  );

  // The first page comes from useAsync; extra pages are appended locally.
  const jobs = useMemo(
    () => [...(first.data?.jobs ?? []), ...pages],
    [first.data, pages],
  );

  const currentCursor = pages.length === 0 ? (first.data?.nextCursor ?? null) : nextCursor;

  const hasActive = jobs.some((job) => isJobActive(job.status));

  // Poll while anything is queued or running so statuses resolve on their own.
  usePolling(
    async () => {
      try {
        await getJobAwareRefresh();
      } catch {
        // Ignore transient failures; the next tick retries.
      }
    },
    { active: hasActive, intervalMs: 5000 },
  );

  async function getJobAwareRefresh() {
    // Refreshing each active job reconciles its status with Trigger.dev, then the
    // list is re-read so ordering and statuses stay consistent.
    const active = jobs.filter((job) => isJobActive(job.status));
    await Promise.all(active.map((job) => getJob(job.id).catch(() => null)));
    await first.refetch({ silent: true });
  }

  async function loadMore() {
    if (!currentCursor) return;
    setLoadingMore(true);
    try {
      const page = await listJobs({ limit: 25, cursor: currentCursor, status: statusFilter || undefined });
      setPages((previous) => [...previous, ...page.jobs]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setActionError(error?.message ?? "Could not load more jobs.");
    } finally {
      setLoadingMore(false);
    }
  }

  function changeFilter(next) {
    setStatusFilter(next);
    setPages([]);
    setNextCursor(null);
    setActionError(null);
  }

  async function refreshOne(job) {
    setRefreshingId(job.id);
    setActionError(null);
    try {
      await getJob(job.id);
      await first.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not refresh the job.");
    } finally {
      setRefreshingId(null);
    }
  }

  async function cancelOne(job) {
    setCancellingId(job.id);
    setActionError(null);
    try {
      const { cancelled } = await cancelJob(job.id);
      if (!cancelled) {
        setActionError(
          "The run had already finished, so nothing was cancelled. Status refreshed instead.",
        );
      }
      await first.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not cancel the job.");
    } finally {
      setCancellingId(null);
    }
  }

  const activeCount = jobs.filter((job) => isJobActive(job.status)).length;

  return (
    <>
      <Topbar
        title="Background Jobs"
        description="Durable teammate turns executed on Trigger.dev. Results are stored against your account."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => first.refetch()}
              loading={first.loading}
            >
              Refresh
            </Button>
            <Link to="/chat" className={buttonClass({ size: "sm" })}>
              <Zap className="size-3.5" aria-hidden="true" />
              Start a job
            </Link>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-slim">
        <div className="mx-auto max-w-4xl space-y-4">
          {activeCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-running px-3 py-2 text-[11px] text-running-ink">
              <Zap className="size-3.5 shrink-0" aria-hidden="true" />
              {activeCount} job{activeCount === 1 ? "" : "s"} still running. Statuses refresh every
              5 seconds.
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
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2.5">
              {FILTERS.map((filter) => (
                <button
                  key={filter.id || "all"}
                  type="button"
                  onClick={() => changeFilter(filter.id)}
                  className={[
                    "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                    statusFilter === filter.id
                      ? "bg-primary-soft text-primary-strong"
                      : "text-ink-muted hover:bg-sidebar hover:text-ink",
                  ].join(" ")}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="p-4">
              <JobList
                jobs={jobs}
                loading={first.loading}
                error={first.error}
                nextCursor={currentCursor}
                onLoadMore={loadMore}
                loadingMore={loadingMore}
                onCancel={cancelOne}
                onRefresh={refreshOne}
                cancellingId={cancellingId}
                refreshingId={refreshingId}
                emptyTitle={
                  statusFilter ? `No ${statusFilter.toLowerCase()} jobs` : "No background jobs yet"
                }
                emptyDescription={
                  statusFilter
                    ? "Try a different status filter, or clear the filter to see everything."
                    : "Open a chat, switch the composer to Background and send a message."
                }
                emptyNote={
                  first.error?.status === 503
                    ? "The server has no TRIGGER_SECRET_KEY configured, so jobs cannot be dispatched yet."
                    : undefined
                }
              />
            </div>
          </Card>

          <div className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <p>
              Jobs are dispatched by <span className="font-mono">POST /api/jobs</span> and stored in
              the <span className="font-mono">AiJob</span> table. Cancel is only available while a
              job is queued or running, and only when the server knows the Trigger.dev run id —
              otherwise the API rejects it rather than risk a cancellation it cannot confirm.
            </p>
          </div>

          {first.error?.status === 503 && (
            <Card className="flex items-start gap-2 border-running-ink/20 bg-running text-running-ink">
              <Briefcase className="mt-px size-4 shrink-0" aria-hidden="true" />
              <p className="text-[11px] leading-relaxed">
                Background jobs are not configured on this server. Set{" "}
                <span className="font-mono">TRIGGER_SECRET_KEY</span> and{" "}
                <span className="font-mono">TRIGGER_PROJECT_REF</span>, then deploy the{" "}
                <span className="font-mono">trigger/</span> task definitions with{" "}
                <span className="font-mono">npx trigger.dev@latest deploy</span>.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
