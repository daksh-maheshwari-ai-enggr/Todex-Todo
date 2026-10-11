import { Link } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Briefcase,
  ChevronRight,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import Topbar from "../components/layout/Topbar.jsx";
import Card, { CardHeader } from "../components/ui/Card.jsx";
import { buttonClass } from "../components/ui/Button.jsx";
import Avatar from "../components/ui/Avatar.jsx";
import Badge, { StatusBadge } from "../components/ui/Badge.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Spinner from "../components/ui/Spinner.jsx";
import ActivityFeed from "../components/activity/ActivityFeed.jsx";
import { listTeammates } from "../services/teammateService.js";
import { listChats, listHandoffs } from "../services/chatService.js";
import { listToolExecutions } from "../services/toolExecutionService.js";
import { listJobs } from "../services/jobService.js";
import { useAsync } from "../hooks/useAsync.js";
import { usePolling } from "../hooks/usePolling.js";
import { isJobActive, jobStatus } from "../utils/status.js";
import { formatRelativeTime, truncate } from "../utils/format.js";

export default function DashboardPage() {
  const { user } = useAuth();

  const teammates = useAsync(() => listTeammates(), []);
  const chats = useAsync(() => listChats(), []);
  const jobs = useAsync(() => listJobs({ limit: 6 }), []);

  const jobRows = jobs.data?.jobs ?? [];
  const activeJobs = jobRows.filter((job) => isJobActive(job.status));
  const failedJobs = jobRows.filter((job) => job.status === "FAILED");

  // While anything is queued or running, keep the job list fresh. Idle
  // dashboards make no background requests.
  usePolling(() => jobs.refetch({ silent: true }), {
    active: activeJobs.length > 0,
    intervalMs: 5000,
  });

  // Tool executions and handoffs are chat-scoped, so the dashboard shows the
  // most recently updated conversation's activity.
  const chatRows = chats.data ?? [];
  const recentChat = chatRows[0] ?? null;

  const activity = useAsync(
    async () => {
      const [executions, handoffs] = await Promise.all([
        listToolExecutions(recentChat.id, { limit: 8 }),
        listHandoffs(recentChat.id, { limit: 8 }),
      ]);
      return { executions: executions.executions, handoffs: handoffs.handoffs };
    },
    [recentChat?.id],
    { enabled: Boolean(recentChat?.id) },
  );

  const teammatesById = Object.fromEntries((teammates.data ?? []).map((bot) => [bot.id, bot]));

  return (
    <>
      <Topbar
        title={`Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description="Your teammates, conversations and durable background jobs."
        actions={
          <>
            <Link to="/teammates" className={buttonClass({ variant: "secondary", size: "sm" })}>
              Manage teammates
            </Link>
            <Link to="/chat" className={buttonClass({ variant: "primary", size: "sm" })}>
              Open chat
            </Link>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-slim">
        <div className="mx-auto max-w-6xl space-y-5">
          <StatsRow
            teammates={teammates}
            chats={chats}
            activeJobs={activeJobs.length}
            failedJobs={failedJobs.length}
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Teammates */}
            <Card padded={false}>
              <div className="px-5 pt-5">
                <CardHeader
                  icon={Users}
                  title="Your teammates"
                  description="Each one has its own job and instructions."
                  action={
                    <Link to="/teammates" className={buttonClass({ variant: "ghost", size: "sm" })}>
                      View all
                    </Link>
                  }
                />
              </div>

              <div className="mt-4 px-5 pb-5">
                {teammates.loading ? (
                  <Spinner label="Loading teammates…" className="py-6" />
                ) : teammates.error ? (
                  <InlineError message={teammates.error.message} />
                ) : (teammates.data ?? []).length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No teammates yet"
                    description="Create your first AI teammate to start delegating work."
                    action={
                      <Link to="/teammates" className={buttonClass({ size: "sm" })}>
                        <Plus className="size-3.5" aria-hidden="true" />
                        New teammate
                      </Link>
                    }
                    className="border-0 bg-transparent py-4"
                  />
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {(teammates.data ?? []).slice(0, 4).map((teammate) => (
                      <li key={teammate.id} className="flex items-center gap-3 py-2.5">
                        <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-ink">{teammate.name}</p>
                          <p className="truncate text-[11px] text-ink-muted">{teammate.job}</p>
                        </div>
                        <Badge tone={teammate.sandboxId ? "idle" : "neutral"}>
                          {teammate.sandboxId ? "sandbox" : "no sandbox"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            {/* Recent chats */}
            <Card padded={false}>
              <div className="px-5 pt-5">
                <CardHeader
                  icon={MessageSquare}
                  title="Recent conversations"
                  description="Newest activity first."
                  action={
                    <Link to="/chat" className={buttonClass({ variant: "ghost", size: "sm" })}>
                      Open workspace
                    </Link>
                  }
                />
              </div>

              <div className="mt-4 px-5 pb-5">
                {chats.loading ? (
                  <Spinner label="Loading conversations…" className="py-6" />
                ) : chats.error ? (
                  <InlineError message={chats.error.message} />
                ) : chatRows.length === 0 ? (
                  <EmptyState
                    icon={MessageSquare}
                    title="No conversations yet"
                    description="Start a chat from the workspace or from a teammate card."
                    className="border-0 bg-transparent py-4"
                  />
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {chatRows.slice(0, 4).map((chat) => {
                      const teammate = chat.botId ? teammatesById[chat.botId] : null;
                      return (
                        <li key={chat.id}>
                          <Link
                            to={`/chat/${chat.id}`}
                            className="flex items-center gap-3 py-2.5 transition-colors hover:bg-sidebar/60"
                          >
                            {teammate ? (
                              <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="md" />
                            ) : (
                              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong">
                                <Users className="size-3.5" aria-hidden="true" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-ink">{chat.title}</p>
                              <p className="truncate text-[11px] text-ink-muted">
                                {teammate ? teammate.name : "Group chat"} ·{" "}
                                {formatRelativeTime(chat.updatedAt ?? chat.createdAt)}
                              </p>
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {/* Background jobs */}
          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                icon={Briefcase}
                title="Background jobs"
                description="Durable Trigger.dev runs. Active jobs refresh automatically."
                action={
                  <Link to="/jobs" className={buttonClass({ variant: "ghost", size: "sm" })}>
                    View all
                  </Link>
                }
              />
            </div>

            <div className="mt-4 px-5 pb-5">
              {jobs.loading ? (
                <Spinner label="Loading jobs…" className="py-6" />
              ) : jobs.error ? (
                <InlineError
                  message={jobs.error.message}
                  hint="Background jobs require TRIGGER_SECRET_KEY on the server."
                />
              ) : jobRows.length === 0 ? (
                <EmptyState
                  icon={Briefcase}
                  title="No background jobs yet"
                  description="Use the Background toggle in the chat composer to run a teammate turn as a durable job."
                  className="border-0 bg-transparent py-4"
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {jobRows.map((job) => (
                    <li key={job.id} className="flex items-center gap-3 py-2.5">
                      <StatusBadge status={jobStatus(job.status)} />
                      <p className="min-w-0 flex-1 truncate text-xs text-ink">
                        {truncate(job.message, 90)}
                      </p>
                      <span className="shrink-0 text-[11px] text-ink-muted">
                        {formatRelativeTime(job.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Activity */}
          <Card padded={false} className="overflow-hidden">
            <div className="px-5 pt-5">
              <CardHeader
                icon={Activity}
                title="Recent activity"
                description={
                  recentChat
                    ? `Tool calls and handoffs in "${recentChat.title}".`
                    : "Tool calls and teammate handoffs."
                }
              />
            </div>

            <div className="mt-4 flex min-h-0 flex-col">
              {!recentChat ? (
                <div className="px-5 pb-5">
                  <EmptyState
                    icon={Activity}
                    title="No activity to show"
                    description="Activity is recorded per conversation. Start a chat to see teammate tool calls and handoffs here."
                    className="border-0 bg-transparent py-4"
                  />
                </div>
              ) : (
                <div className="flex max-h-96 flex-col">
                  <ActivityFeed
                    executions={activity.data?.executions ?? []}
                    handoffs={activity.data?.handoffs ?? []}
                    loading={activity.loading}
                    error={activity.error}
                    onRefresh={() => activity.refetch({ silent: true })}
                    limit={4}
                    compactHandoffs
                    emptyTitle="No tool calls recorded yet"
                    emptyDescription="Teammate tool calls and handoffs appear here as they happen."
                  />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatsRow({ teammates, chats, activeJobs, failedJobs }) {
  const stats = [
    { label: "Teammates", value: teammates.data?.length, icon: Users, loading: teammates.loading },
    { label: "Conversations", value: chats.data?.length, icon: MessageSquare, loading: chats.loading },
    { label: "Active jobs", value: activeJobs, icon: Briefcase, loading: false, tone: "running" },
    { label: "Failed jobs", value: failedJobs, icon: AlertCircle, loading: false, tone: "error" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="flex items-center gap-3 !py-4">
          <span
            className={[
              "grid size-9 shrink-0 place-items-center rounded-xl",
              stat.tone === "error"
                ? "bg-error text-error-ink"
                : stat.tone === "running"
                  ? "bg-running text-running-ink"
                  : "bg-primary-soft text-primary-strong",
            ].join(" ")}
          >
            <stat.icon className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-lg leading-none font-semibold text-ink">
              {stat.loading || stat.value == null ? "—" : stat.value}
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">{stat.label}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

function InlineError({ message, hint }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {message}
        {hint ? ` ${hint}` : ""}
      </span>
    </div>
  );
}
