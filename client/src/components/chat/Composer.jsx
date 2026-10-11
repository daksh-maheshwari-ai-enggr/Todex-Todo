import { useState } from "react";
import { AlertCircle, Send, Sparkles, Zap } from "lucide-react";
import Button from "../ui/Button.jsx";
import Avatar from "../ui/Avatar.jsx";

// Composer for the chat workspace.
//
// Two send modes map onto two real backend endpoints:
//   * "reply"      -> POST /api/agents/:botId/respond  (persists the user message
//                     and the assistant reply in one synchronous turn)
//   * "background" -> POST /api/jobs                   (durable Trigger.dev run)
//
// The mode is only offered when there is a teammate to address, because the
// backend requires a specific botId for both flows.
export default function Composer({
  participants = [],
  selectedBotId,
  onSelectBot,
  onSend,
  onSendBackground,
  sending = false,
  disabled = false,
  backgroundAvailable = true,
  maxLength = 4000,
  error = null,
}) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState("reply");

  const tooLong = value.length > maxLength;
  const canSend = value.trim().length > 0 && !tooLong && !disabled && !sending && !!selectedBotId;
  const canSendBackground = canSend && backgroundAvailable && !!onSendBackground;

  async function submit(event) {
    event.preventDefault();
    if (!canSend) return;

    const message = value.trim();
    try {
      if (mode === "background" && canSendBackground) {
        await onSendBackground(message);
      } else {
        await onSend(message);
      }
      setValue("");
    } catch {
      // The parent surfaces the error; keep the draft so it is never lost.
    }
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(event);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-card px-5 py-3">
      <div className="mx-auto max-w-3xl">
        {participants.length > 1 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium text-ink-muted">Reply from</span>
            {participants.map((teammate) => (
              <button
                key={teammate.id}
                type="button"
                onClick={() => onSelectBot?.(teammate.id)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
                  teammate.id === selectedBotId
                    ? "border-primary/40 bg-primary-soft text-primary-strong"
                    : "border-line bg-card text-ink-muted hover:bg-sidebar",
                ].join(" ")}
              >
                <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="sm" className="size-4 text-[8px] ring-0" />
                {teammate.name}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              rows={2}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={disabled}
              placeholder={
                selectedBotId
                  ? "Ask your teammate to do something…  (Enter to send, Shift+Enter for a new line)"
                  : "Select a teammate to start the conversation"
              }
              className="w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 transition-colors focus:border-primary focus:outline-none disabled:opacity-60 scrollbar-slim"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* The mode toggle only appears where a durable job flow exists. */}
            {onSendBackground && (
              <button
                type="button"
                onClick={() => setMode(mode === "reply" ? "background" : "reply")}
                title={
                  mode === "background"
                    ? "Durable background job (Trigger.dev). Click for a synchronous reply."
                    : "Synchronous reply. Click to run as a durable background job."
                }
                className={[
                  "inline-flex h-10 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
                  mode === "background"
                    ? "border-primary/40 bg-primary-soft text-primary-strong"
                    : "border-line bg-card text-ink-muted hover:bg-sidebar",
                ].join(" ")}
              >
                {mode === "background" ? (
                  <Zap className="size-3.5" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden="true" />
                )}
                {mode === "background" ? "Background" : "Reply"}
              </button>
            )}

            <Button type="submit" size="lg" disabled={!canSend} loading={sending} icon={Send}>
              Send
            </Button>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-muted">
          <span>
            {mode === "background" && onSendBackground
              ? "Runs as a durable Trigger.dev job. Track it under Background Jobs."
              : "Reply is generated by the teammate's LangGraph agent."}
          </span>
          <span className={tooLong ? "font-medium text-error-ink" : ""}>
            {value.length}/{maxLength}
          </span>
        </div>
      </div>
    </form>
  );
}
