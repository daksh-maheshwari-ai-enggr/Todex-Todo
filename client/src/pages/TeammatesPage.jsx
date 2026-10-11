import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Plus, Users } from "lucide-react";
import Topbar from "../components/layout/Topbar.jsx";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Spinner from "../components/ui/Spinner.jsx";
import Modal from "../components/ui/Modal.jsx";
import TeammateCard from "../components/teammates/TeammateCard.jsx";
import TeammateForm from "../components/teammates/TeammateForm.jsx";
import {
  createTeammate,
  deleteTeammate,
  listTeammates,
  updateTeammate,
} from "../services/teammateService.js";
import { createChat, listChats } from "../services/chatService.js";
import { useAsync } from "../hooks/useAsync.js";

export default function TeammatesPage() {
  const navigate = useNavigate();
  const teammates = useAsync(() => listTeammates(), []);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const rows = teammates.data ?? [];

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(teammate) {
    setEditing(teammate);
    setFormOpen(true);
  }

  async function saveTeammate(values) {
    if (editing) {
      await updateTeammate(editing.id, values);
    } else {
      await createTeammate(values);
    }
    await teammates.refetch({ silent: true });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setActionError(null);

    try {
      await deleteTeammate(pendingDelete.id);
      setPendingDelete(null);
      await teammates.refetch({ silent: true });
    } catch (error) {
      setActionError(error?.message || "Could not delete the teammate.");
    } finally {
      setDeleting(false);
    }
  }

  // Reuse an existing direct chat with this teammate instead of creating a new
  // one on every click.
  async function startChat(teammate) {
    setBusyId(teammate.id);
    setActionError(null);

    try {
      const chats = await listChats();
      const existing = chats.find((chat) => chat.botId === teammate.id);
      const chat = existing ?? (await createChat({ title: `Chat with ${teammate.name}`, botId: teammate.id }));
      navigate(`/chat/${chat.id}`);
    } catch (error) {
      setActionError(error?.message || "Could not open a chat with this teammate.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Topbar
        title="AI Teammates"
        description="Create teammates with their own job, instructions and isolated sandbox."
        actions={
          <Button icon={Plus} size="sm" onClick={openCreate}>
            New teammate
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-slim">
        <div className="mx-auto max-w-6xl space-y-4">
          {actionError && (
            <div className="flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
              <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}

          {teammates.loading ? (
            <Card>
              <Spinner label="Loading teammates…" className="py-10" />
            </Card>
          ) : teammates.error ? (
            <EmptyState
              icon={AlertCircle}
              title="Could not load teammates"
              description={teammates.error.message}
              note="Teammates come from GET /api/bots."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No teammates yet"
              description="A teammate is a named AI worker with a job description your other teammates can delegate to."
              action={
                <Button icon={Plus} size="sm" onClick={openCreate}>
                  Create your first teammate
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((teammate) => (
                <TeammateCard
                  key={teammate.id}
                  teammate={teammate}
                  busy={busyId === teammate.id}
                  onChat={startChat}
                  onEdit={openEdit}
                  onDelete={setPendingDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TeammateForm
        open={formOpen}
        teammate={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={saveTeammate}
      />

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        size="sm"
        title="Delete teammate?"
        description="This removes the teammate and its chats, messages, tool history and handoffs. It cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              Delete teammate
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-ink-muted">
          You are about to delete{" "}
          <span className="font-medium text-ink">{pendingDelete?.name}</span> (
          {pendingDelete?.job}). Deleting a teammate is a cascading backend operation, so any
          sandbox it owns should be stopped first if you still need its files.
        </p>
      </Modal>
    </>
  );
}
