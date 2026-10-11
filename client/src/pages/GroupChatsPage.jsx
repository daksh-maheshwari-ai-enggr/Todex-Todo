import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowRightLeft, Plus, UserPlus, Users, X } from "lucide-react";
import Topbar from "../components/layout/Topbar.jsx";
import Button, { buttonClass } from "../components/ui/Button.jsx";
import Avatar from "../components/ui/Avatar.jsx";
import Badge from "../components/ui/Badge.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Spinner, { SpinnerBlock } from "../components/ui/Spinner.jsx";
import Modal from "../components/ui/Modal.jsx";
import Input from "../components/ui/Input.jsx";
import MessageList from "../components/chat/MessageList.jsx";
import Composer from "../components/chat/Composer.jsx";
import ActivityFeed from "../components/activity/ActivityFeed.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useAsync } from "../hooks/useAsync.js";
import {
  addParticipant,
  createGroupChat,
  getChat,
  listChats,
  listHandoffs,
  listMessages,
  listParticipants,
  removeParticipant,
  requestTeammateResponse,
} from "../services/chatService.js";
import { listToolExecutions } from "../services/toolExecutionService.js";
import { listTeammates } from "../services/teammateService.js";
import { formatRelativeTime } from "../utils/format.js";

export default function GroupChatsPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();

  const chats = useAsync(() => listChats(), []);
  const teammates = useAsync(() => listTeammates(), []);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", botIds: [] });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const groupChats = useMemo(
    () => (chats.data ?? []).filter((chat) => !chat.botId),
    [chats.data],
  );

  async function submitCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const chat = await createGroupChat({ title: form.title.trim(), botIds: form.botIds });
      setCreateOpen(false);
      setForm({ title: "", botIds: [] });
      await chats.refetch({ silent: true });
      navigate(`/group-chats/${chat.id}`);
    } catch (error) {
      setCreateError(error?.message ?? "Could not create the group chat.");
    } finally {
      setCreating(false);
    }
  }

  function toggleBot(botId) {
    setForm((previous) => ({
      ...previous,
      botIds: previous.botIds.includes(botId)
        ? previous.botIds.filter((id) => id !== botId)
        : [...previous.botIds, botId],
    }));
  }

  return (
    <>
      <Topbar
        title="Group Chats"
        description="Several teammates in one conversation, with handoffs between them."
        actions={
          <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
            New group chat
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-card md:flex">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-xs font-semibold text-ink">Group conversations</h2>
            <p className="mt-0.5 text-[11px] text-ink-muted">{groupChats.length} total</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-slim">
            {chats.loading ? (
              <Spinner label="Loading…" className="py-6" />
            ) : groupChats.length === 0 ? (
              <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-muted">
                No group chats yet. Create one to let teammates collaborate.
              </p>
            ) : (
              <ul className="space-y-1">
                {groupChats.map((chat) => (
                  <li key={chat.id}>
                    <Link
                      to={`/group-chats/${chat.id}`}
                      className={[
                        "block rounded-lg px-3 py-2 transition-colors",
                        chat.id === chatId ? "bg-primary-soft" : "hover:bg-sidebar",
                      ].join(" ")}
                    >
                      <p className="truncate text-xs font-medium text-ink">{chat.title}</p>
                      <p className="truncate text-[11px] text-ink-muted">
                        {formatRelativeTime(chat.updatedAt ?? chat.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
          {chatId ? (
            <GroupChatView key={chatId} chatId={chatId} teammates={teammates} />
          ) : (
            <div className="grid flex-1 place-items-center">
              <EmptyState
                icon={Users}
                title="Select a group chat"
                description="Pick a conversation on the left, or create a new group chat with several teammates."
                action={
                  <Button size="sm" icon={Plus} onClick={() => setCreateOpen(true)}>
                    New group chat
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New group chat"
        description="Pick the teammates that take part. They can hand work to each other."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              loading={creating}
              disabled={form.title.trim().length === 0 || form.botIds.length === 0}
            >
              Create group chat
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            name="title"
            maxLength={100}
            value={form.title}
            onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
            placeholder="Launch planning"
            hint="Up to 100 characters."
          />

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink">Teammates</p>
            {teammates.loading ? (
              <Spinner label="Loading teammates…" className="py-4" />
            ) : (teammates.data ?? []).length === 0 ? (
              <p className="text-[11px] text-ink-muted">
                You need at least one teammate before creating a group chat.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line p-1.5 scrollbar-slim">
                {(teammates.data ?? []).map((teammate) => {
                  const selected = form.botIds.includes(teammate.id);
                  return (
                    <li key={teammate.id}>
                      <button
                        type="button"
                        onClick={() => toggleBot(teammate.id)}
                        className={[
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          selected ? "bg-primary-soft" : "hover:bg-sidebar",
                        ].join(" ")}
                      >
                        <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="sm" className="ring-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-ink">{teammate.name}</p>
                          <p className="truncate text-[11px] text-ink-muted">{teammate.job}</p>
                        </div>
                        {selected && <Badge tone="idle">selected</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {createError && (
            <div className="flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
              <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{createError}</span>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function GroupChatView({ chatId, teammates }) {
  const { user } = useAuth();

  const chat = useAsync(() => getChat(chatId), [chatId]);
  const messages = useAsync(() => listMessages(chatId), [chatId]);
  const participants = useAsync(() => listParticipants(chatId), [chatId]);
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

  const teammatesById = useMemo(
    () => Object.fromEntries((teammates.data ?? []).map((bot) => [bot.id, bot])),
    [teammates.data],
  );

  const participantBots = useMemo(
    () => (participants.data ?? []).map((row) => row.bot).filter(Boolean),
    [participants.data],
  );

  useEffect(() => {
    if (selectedBotId || participantBots.length === 0) return;
    setSelectedBotId(participantBots[0].id);
  }, [participantBots, selectedBotId]);

  const addable = useMemo(
    () => (teammates.data ?? []).filter((bot) => !participantBots.some((p) => p.id === bot.id)),
    [teammates.data, participantBots],
  );

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
      await Promise.all([
        messages.refetch({ silent: true }),
        activity.refetch({ silent: true }),
        chat.refetch({ silent: true }),
      ]);
    }
  }

  async function onAdd(botId) {
    setActionError(null);
    try {
      await addParticipant(chatId, botId);
      await participants.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not add the participant.");
    }
  }

  async function onRemove(botId) {
    setActionError(null);
    try {
      await removeParticipant(chatId, botId);
      if (selectedBotId === botId) setSelectedBotId(null);
      await participants.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message ?? "Could not remove the participant.");
    }
  }

  if (chat.loading && !chat.data) return <SpinnerBlock label="Loading group chat…" />;

  if (chat.error || !chat.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Group chat not found"
        description={chat.error?.message ?? "It may have been deleted."}
        action={
          <Link to="/group-chats" className={buttonClass({ size: "sm" })}>
            Back to group chats
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <section className="flex min-w-0 flex-[3] flex-col overflow-hidden rounded-card border border-line bg-card">
        <div className="border-b border-line px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-ink">{chat.data.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {participantBots.length === 0 ? (
              <span className="text-[11px] text-ink-muted">No participants.</span>
            ) : (
              participantBots.map((bot) => (
                <span
                  key={bot.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sidebar px-2 py-1 text-[11px]"
                >
                  <Avatar seed={bot.avatar ?? bot.id} name={bot.name} size="sm" className="size-4 text-[8px] ring-0" />
                  <span className="font-medium text-ink">{bot.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemove(bot.id)}
                    aria-label={`Remove ${bot.name}`}
                    title={`Remove ${bot.name} from this chat`}
                    className="text-ink-muted transition-colors hover:text-error-ink"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))
            )}

            {addable.length > 0 && (
              <label className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2 py-1 text-[11px] text-ink-muted">
                <UserPlus className="size-3" aria-hidden="true" />
                <select
                  value=""
                  onChange={(event) => event.target.value && onAdd(event.target.value)}
                  className="bg-transparent text-[11px] text-ink focus:outline-none"
                  aria-label="Add a participant"
                >
                  <option value="">Add teammate…</option>
                  {addable.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        {actionError && (
          <div className="flex items-start gap-2 border-b border-line bg-error px-4 py-2 text-[11px] text-error-ink">
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
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
          emptyDescription="Send a message and choose which teammate should answer."
        />

        <Composer
          participants={participantBots}
          selectedBotId={selectedBotId}
          onSelectBot={setSelectedBotId}
          onSend={send}
          sending={sending}
          disabled={participantBots.length === 0}
        />
      </section>

      <section className="hidden min-w-0 flex-[2] flex-col overflow-hidden rounded-card border border-line bg-card lg:flex">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid size-7 place-items-center rounded-lg bg-primary-soft text-primary-strong">
            <ArrowRightLeft className="size-3.5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xs font-semibold text-ink">Handoffs & activity</h2>
            <p className="text-[11px] text-ink-muted">
              Delegations and tool calls recorded for this chat.
            </p>
          </div>
        </div>

        <ActivityFeed
          executions={activity.data?.executions ?? []}
          handoffs={activity.data?.handoffs ?? []}
          loading={activity.loading}
          error={activity.error}
          onRefresh={() => activity.refetch({ silent: true })}
          emptyTitle="No handoffs yet"
          emptyDescription="When one teammate delegates to another, the delegation chain shows here."
          emptyNote="Sourced from GET /api/handoffs/:chatId and GET /api/tool-executions/:chatId."
        />
      </section>
    </div>
  );
}
