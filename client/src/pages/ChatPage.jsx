import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Check,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import Topbar from "../components/layout/Topbar.jsx";
import Card from "../components/ui/Card.jsx";
import Button, { buttonClass } from "../components/ui/Button.jsx";
import Avatar from "../components/ui/Avatar.jsx";
import Badge from "../components/ui/Badge.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Spinner, { SpinnerBlock } from "../components/ui/Spinner.jsx";
import Modal from "../components/ui/Modal.jsx";
import Input from "../components/ui/Input.jsx";
import ChatHeader from "../components/chat/ChatHeader.jsx";
import MessageList from "../components/chat/MessageList.jsx";
import Composer from "../components/chat/Composer.jsx";
import SandboxPanel from "../components/sandbox/SandboxPanel.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import { usePolling } from "../hooks/usePolling.js";
import {
  createChat,
  deleteChat,
  getChat,
  listChats,
  listHandoffs,
  listMessages,
  listParticipants,
  requestTeammateResponse,
  updateChat,
} from "../services/chatService.js";
import { listToolExecutions } from "../services/toolExecutionService.js";
import { listTeammates } from "../services/teammateService.js";
import { getJob, startJob } from "../services/jobService.js";
import { formatRelativeTime } from "../utils/format.js";
import { isJobActive } from "../utils/status.js";

export default function ChatPage() {
  const { chatId } = useParams();

  // Without a chat id the workspace shows the conversation picker instead.
  if (!chatId) {
    return <ChatPicker />;
  }

  return <ChatWorkspace key={chatId} chatId={chatId} />;
}

function ChatWorkspace({ chatId }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const chat = useAsync(() => getChat(chatId), [chatId]);
  const messages = useAsync(() => listMessages(chatId), [chatId]);
  const participants = useAsync(() => listParticipants(chatId), [chatId]);
  const teammates = useAsync(() => listTeammates(), []);

  const activity = useAsync(
    async () => {
      const [executions, handoffs] = await Promise.all([
        listToolExecutions(chatId, { limit: 100 }),
        listHandoffs(chatId, { limit: 100 }),
      ]);
      return { executions: executions.executions, handoffs: handoffs.handoffs };
    },
    [chatId],
  );

  const [selectedBotId, setSelectedBotId] = useState(null);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [activeJob, setActiveJob] = useState(null);

  // Chat management (rename / delete) uses the existing PATCH and DELETE routes.
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const teammatesById = useMemo(
    () => Object.fromEntries((teammates.data ?? []).map((bot) => [bot.id, bot])),
    [teammates.data],
  );

  const chatRecord = chat.data;

  // Direct chats have exactly one teammate; group chats use validated
  // participants. Both come from server-resolved data, never from the model.
  const participantBots = useMemo(() => {
    if (!chatRecord) return [];
    if (chatRecord.botId) {
      const direct = teammatesById[chatRecord.botId] ?? chatRecord.bot ?? null;
      return direct ? [direct] : [];
    }
    return (participants.data ?? []).map((row) => row.bot).filter(Boolean);
  }, [chatRecord, participants.data, teammatesById]);

  // Default the replying teammate to the direct chat's bot, or the first
  // participant of a group chat.
  useEffect(() => {
    if (selectedBotId || participantBots.length === 0) return;
    setSelectedBotId(participantBots[0].id);
  }, [participantBots, selectedBotId]);

  const selectedTeammate = teammatesById[selectedBotId] ?? participantBots[0] ?? null;

  // While a teammate is generating, poll the activity so tool calls and
  // handoffs appear as they are persisted.
  usePolling(() => activity.refetch({ silent: true }), {
    active: pending,
    intervalMs: 5000,
  });

  // While a background job is active, poll its status; when it finishes, pull in
  // the messages and activity the worker persisted.
  usePolling(
    async () => {
      if (!activeJob) return;
      try {
        const { job } = await getJob(activeJob.id);
        setActiveJob(job);
        if (!isJobActive(job.status)) {
          await Promise.all([
            messages.refetch({ silent: true }),
            activity.refetch({ silent: true }),
            chat.refetch({ silent: true }),
          ]);
        }
      } catch {
        // Transient polling failure: the next tick retries.
      }
    },
    { active: Boolean(activeJob && isJobActive(activeJob.status)), intervalMs: 5000 },
  );

  async function refreshAll() {
    await Promise.all([
      messages.refetch({ silent: true }),
      activity.refetch({ silent: true }),
      chat.refetch({ silent: true }),
      participants.refetch({ silent: true }),
    ]);
  }

  async function submitRename(event) {
    event.preventDefault();
    const title = renameValue.trim();
    if (!title) return;

    setRenaming(true);
    setActionError(null);
    try {
      await updateChat(chatId, { title });
      setRenameOpen(false);
      await chat.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not rename the conversation.");
    } finally {
      setRenaming(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    setActionError(null);
    try {
      await deleteChat(chatId);
      navigate("/chat", { replace: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not delete the conversation.");
      setDeleting(false);
    }
  }

  // Synchronous turn: POST /api/agents/:botId/respond persists both the user
  // message and the assistant reply, so no separate message call is made here.
  async function send(message) {
    setActionError(null);
    setSending(true);
    setPending(true);

    try {
      await requestTeammateResponse({ botId: selectedBotId, chatId, message });
    } catch (error) {
      const saved = error?.userMessage ? " Your message was saved." : "";
      setActionError(`${error?.message ?? "The teammate could not respond."}${saved}`);
    } finally {
      setSending(false);
      setPending(false);
      await refreshAll();
    }
  }

  // Durable turn: POST /api/jobs returns immediately with a job id.
  async function sendBackground(message) {
    setActionError(null);
    setSending(true);

    try {
      const { job, deduplicated } = await startJob({ botId: selectedBotId, chatId, message });
      setActiveJob(job);
      if (deduplicated) {
        setActionError("An identical background job was already in flight, so it was reused.");
      }
    } catch (error) {
      setActionError(error?.message ?? "Could not start the background job.");
    } finally {
      setSending(false);
    }
  }

  if (chat.loading && !chatRecord) return <SpinnerBlock label="Opening conversation…" />;

  if (chat.error || !chatRecord) {
    return (
      <>
        <Topbar title="Conversation" description="This conversation could not be loaded." />
        <div className="min-h-0 flex-1 p-6">
          <EmptyState
            icon={AlertCircle}
            title="Conversation not found"
            description={chat.error?.message ?? "It may have been deleted, or it belongs to another account."}
            action={
              <Link to="/chat" className={buttonClass({ size: "sm" })}>
                Back to conversations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Chat Workspace"
        description="Talk to a teammate and watch its sandbox activity in real time."
        actions={
          <>
            <Link to="/chat" className={buttonClass({ variant: "ghost", size: "sm" })}>
              All conversations
            </Link>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={refreshAll}
              loading={activity.loading && !activity.data}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {/* Chat (2) : Sandbox (3) — the sandbox takes ~60% of the workspace. */}
        <div className="flex h-full min-h-0 gap-4">
          <section className="flex min-w-0 flex-[2] flex-col overflow-hidden rounded-card border border-line bg-card">
            <ChatHeader
              chat={chatRecord}
              teammate={selectedTeammate}
              participants={participantBots}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Pencil}
                    onClick={() => {
                      setRenameValue(chatRecord.title);
                      setRenameOpen(true);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    className="text-error-ink hover:bg-error"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </Button>
                </>
              }
            />

            {actionError && (
              <div className="flex items-start gap-2 border-b border-line bg-error px-5 py-2 text-[11px] text-error-ink">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>{actionError}</span>
              </div>
            )}

            {activeJob && (
              <div className="flex items-center gap-2 border-b border-line bg-running px-5 py-2 text-[11px] text-running-ink">
                <Zap className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  Background job {activeJob.id.slice(0, 8)} is {activeJob.status.toLowerCase()}.
                  {isJobActive(activeJob.status)
                    ? " The chat updates when it finishes."
                    : " Messages have been refreshed."}
                </span>
                {!isJobActive(activeJob.status) && (
                  <button
                    type="button"
                    onClick={() => setActiveJob(null)}
                    className="font-medium hover:underline"
                  >
                    Dismiss
                  </button>
                )}
                <Link to="/jobs" className="font-medium hover:underline">
                  View jobs
                </Link>
              </div>
            )}

            <MessageList
              messages={messages.data ?? []}
              teammatesById={teammatesById}
              currentUserId={user?.id}
              loading={messages.loading}
              error={messages.error}
              pending={pending}
              emptyTitle="No messages yet"
              emptyDescription={
                selectedTeammate
                  ? `Ask ${selectedTeammate.name} to do something — every reply, tool call and handoff is persisted.`
                  : "Add a teammate to this chat to start the conversation."
              }
            />

            <Composer
              participants={participantBots}
              selectedBotId={selectedBotId}
              onSelectBot={setSelectedBotId}
              onSend={send}
              onSendBackground={sendBackground}
              sending={sending}
              disabled={participantBots.length === 0}
              backgroundAvailable
              error={null}
            />
          </section>

          <div className="hidden min-w-0 flex-[3] flex-col xl:flex">
            <SandboxPanel
              teammate={selectedTeammate}
              executions={activity.data?.executions ?? []}
              handoffs={activity.data?.handoffs ?? []}
              activityLoading={activity.loading}
              activityError={activity.error}
              onRefreshActivity={() => activity.refetch({ silent: true })}
            />
          </div>
        </div>
      </div>

      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        size="sm"
        title="Rename conversation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)} disabled={renaming}>
              Cancel
            </Button>
            <Button type="submit" form="rename-chat-form" loading={renaming}>
              Save
            </Button>
          </>
        }
      >
        <form id="rename-chat-form" onSubmit={submitRename}>
          <Input
            label="Title"
            name="title"
            maxLength={100}
            required
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            hint="Up to 100 characters."
          />
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        title="Delete conversation?"
        description="This permanently removes the chat, its messages, tool history and handoffs."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              Delete conversation
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-ink-muted">
          Deleting is permanent and cannot be undone. Any background job that is still running will
          keep executing on Trigger.dev but will no longer be visible here.
        </p>
      </Modal>
    </>
  );
}

// Shown when no conversation is selected.
function ChatPicker() {
  const navigate = useNavigate();
  const chats = useAsync(() => listChats(), []);
  const teammates = useAsync(() => listTeammates(), []);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const rows = chats.data ?? [];

  async function startWith(teammate) {
    setBusyId(teammate.id);
    setError(null);
    try {
      const existing = rows.find((chat) => chat.botId === teammate.id);
      const chat = existing ?? (await createChat({ title: `Chat with ${teammate.name}`, botId: teammate.id }));
      navigate(`/chat/${chat.id}`);
    } catch (startError) {
      setError(startError?.message ?? "Could not open the chat.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Topbar
        title="Chat Workspace"
        description="Pick a conversation, or start a new one with a teammate."
        actions={
          <Link to="/group-chats" className={buttonClass({ variant: "secondary", size: "sm" })}>
            <Users className="size-3.5" aria-hidden="true" />
            Group chats
          </Link>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-slim">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">
          {error && (
            <div className="lg:col-span-2 flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
              <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <Card padded={false}>
            <div className="px-5 pt-5">
              <h2 className="text-sm font-semibold text-ink">Conversations</h2>
              <p className="mt-0.5 text-xs text-ink-muted">Most recently updated first.</p>
            </div>
            <div className="mt-4 px-5 pb-5">
              {chats.loading ? (
                <Spinner label="Loading conversations…" className="py-6" />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No conversations yet"
                  description="Start one from a teammate on the right."
                  className="border-0 bg-transparent py-4"
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {rows.map((chat) => (
                    <li key={chat.id}>
                      <Link
                        to={`/chat/${chat.id}`}
                        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-sidebar/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-ink">{chat.title}</p>
                          <p className="truncate text-[11px] text-ink-muted">
                            {chat.bot?.name ?? "Group chat"} ·{" "}
                            {formatRelativeTime(chat.updatedAt ?? chat.createdAt)}
                          </p>
                        </div>
                        <Badge tone={chat.botId ? "neutral" : "idle"}>
                          {chat.botId ? "direct" : "group"}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <h2 className="text-sm font-semibold text-ink">Start with a teammate</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Reuses an existing direct chat when there is one.
              </p>
            </div>
            <div className="mt-4 px-5 pb-5">
              {teammates.loading ? (
                <Spinner label="Loading teammates…" className="py-6" />
              ) : (teammates.data ?? []).length === 0 ? (
                <EmptyState
                  icon={Plus}
                  title="No teammates yet"
                  description="Create a teammate before starting a conversation."
                  action={
                    <Link to="/teammates" className={buttonClass({ size: "sm" })}>
                      Create a teammate
                    </Link>
                  }
                  className="border-0 bg-transparent py-4"
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {(teammates.data ?? []).map((teammate) => (
                    <li key={teammate.id} className="flex items-center gap-3 py-2.5">
                      <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-ink">{teammate.name}</p>
                        <p className="truncate text-[11px] text-ink-muted">{teammate.job}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="soft"
                        loading={busyId === teammate.id}
                        onClick={() => startWith(teammate)}
                        icon={Check}
                      >
                        Chat
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
