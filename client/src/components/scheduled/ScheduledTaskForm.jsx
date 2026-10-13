import { useEffect, useState } from "react";
import Button from "../ui/Button.jsx";
import Input, { Select, Textarea } from "../ui/Input.jsx";
import { listParticipants } from "../../services/chatService.js";

// Create a scheduled run (ROADMAP.md Phase D).
//
// A task belongs to a chat and a teammate, because its runs are ordinary
// background runs: they post their messages, tool calls and approvals into that
// chat. For a direct chat the teammate is fixed; a group chat has to say which
// participant should do the work.

// Default one-shot time: a few minutes out, which is also the quickest way to
// see a schedule actually fire.
function defaultRunAtLocal() {
  const when = new Date(Date.now() + 5 * 60_000);
  when.setSeconds(0, 0);
  // datetime-local wants local wall time without a timezone suffix.
  const pad = (value) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(
    when.getHours(),
  )}:${pad(when.getMinutes())}`;
}

const CADENCES = [
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Hourly", minutes: 60 },
  { label: "Daily", minutes: 1440 },
];

export default function ScheduledTaskForm({ chats = [], onSubmit, busy = false, error = null }) {
  const [chatId, setChatId] = useState(chats[0]?.id ?? "");
  const [botId, setBotId] = useState("");
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState("once");
  const [runAtLocal, setRunAtLocal] = useState(defaultRunAtLocal);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [participants, setParticipants] = useState([]);
  const [localError, setLocalError] = useState(null);

  const chat = chats.find((entry) => entry.id === chatId) ?? null;
  const isDirect = Boolean(chat?.botId);

  useEffect(() => {
    if (!chatId || isDirect) {
      setParticipants([]);
      return undefined;
    }

    let cancelled = false;
    listParticipants(chatId)
      .then((rows) => {
        if (cancelled) return;
        const bots = rows.map((row) => row.bot).filter(Boolean);
        setParticipants(bots);
        setBotId((current) =>
          bots.some((bot) => bot.id === current) ? current : (bots[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled) setParticipants([]);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId, isDirect]);

  const resolvedBotId = isDirect ? chat?.botId : botId;

  async function submit(event) {
    event.preventDefault();
    setLocalError(null);

    const text = goal.trim();
    if (!chatId) return setLocalError("Choose the chat this task should run in.");
    if (!resolvedBotId) return setLocalError("Choose the teammate that should do the work.");
    if (!text) return setLocalError("Describe what the teammate should do.");

    let runAt = null;
    if (mode === "once") {
      const when = new Date(runAtLocal);
      if (Number.isNaN(when.getTime())) return setLocalError("Choose a valid date and time.");
      if (when.getTime() <= Date.now()) {
        return setLocalError("The scheduled time has to be in the future.");
      }
      runAt = when.toISOString();
    }

    return onSubmit({
      chatId,
      botId: resolvedBotId,
      goal: text,
      ...(mode === "once" ? { runAt } : { intervalMinutes: Number(intervalMinutes) }),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Select
        label="Chat"
        name="chatId"
        value={chatId}
        onChange={(event) => setChatId(event.target.value)}
        hint="Runs post their messages, results and approvals into this chat."
      >
        {chats.length === 0 && <option value="">No chats yet</option>}
        {chats.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.title}
            {entry.bot?.name ? ` — ${entry.bot.name}` : ""}
          </option>
        ))}
      </Select>

      {!isDirect && (
        <Select
          label="Teammate"
          name="botId"
          value={botId}
          onChange={(event) => setBotId(event.target.value)}
          hint="Which participant of this group chat should run the task."
        >
          {participants.length === 0 && <option value="">No participants</option>}
          {participants.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name} — {bot.job}
            </option>
          ))}
        </Select>
      )}

      <Textarea
        label="What should it do?"
        name="goal"
        rows={3}
        maxLength={4000}
        placeholder="e.g. Open the team dashboard, check for failed jobs, and post a short summary here."
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
      />

      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink">When</span>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "once", label: "Once" },
            { id: "repeat", label: "Repeating" },
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              className={[
                "rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors",
                mode === option.id
                  ? "border-primary bg-primary-soft text-primary-strong"
                  : "border-line bg-card text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "once" ? (
        <Input
          label="Run at"
          name="runAt"
          type="datetime-local"
          value={runAtLocal}
          onChange={(event) => setRunAtLocal(event.target.value)}
          hint="Your local time. The sweep checks every minute, so it fires within a minute of this."
        />
      ) : (
        <div className="space-y-2">
          <Input
            label="Every (minutes)"
            name="intervalMinutes"
            type="number"
            min={1}
            max={43200}
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {CADENCES.map((cadence) => (
              <button
                key={cadence.minutes}
                type="button"
                onClick={() => setIntervalMinutes(cadence.minutes)}
                className="rounded-full border border-line bg-card px-2.5 py-1 text-[10px] font-medium text-ink-muted transition-colors hover:text-ink"
              >
                {cadence.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-muted">
            Repeats start one interval from now. Missed slots are skipped, not queued.
          </p>
        </div>
      )}

      {(localError || error) && (
        <p className="rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
          {localError || error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy || chats.length === 0}>
          Schedule it
        </Button>
        <span className="text-[11px] text-ink-muted">
          Requires <span className="font-mono">TRIGGER_SECRET_KEY</span> — scheduled runs are
          durable background jobs.
        </span>
      </div>
    </form>
  );
}
