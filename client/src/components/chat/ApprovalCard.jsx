import { useState } from "react";
import { Check, ShieldQuestion, X } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import { Textarea } from "../ui/Input.jsx";

// The pause card: rendered while a teammate's run is parked on a human
// approval (ROADMAP.md Phase A). Two shapes:
//
//   QUESTION — the agent asked something via ask_user. Quick-reply options and
//              a free-text answer both resume the SAME run with that text as
//              the deferred tool result.
//   ACTION   — a gated tool call is waiting for a yes/no. Approving executes
//              the stored call for real; rejecting tells the model why.
//
// The question itself also exists as a normal chat message (persisted when the
// run paused), so this card stays action-focused.

export default function ApprovalCard({ approval, busy = false, error = null, onRespond }) {
  const [text, setText] = useState("");

  if (!approval) return null;

  const isAction = approval.kind === "ACTION";
  const options = approval.options ?? [];

  async function submitAnswer(value) {
    const answer = String(value ?? "").trim();
    if (!answer || busy) return;
    const handled = await onRespond?.(approval, { answer });
    if (handled !== false) setText("");
  }

  async function submitDecision(approvedFlag) {
    if (busy) return;
    const note = text.trim();
    const handled = await onRespond?.(approval, { approved: approvedFlag, note });
    if (handled !== false) setText("");
  }

  return (
    <div className="border-t border-line bg-primary-soft/40 px-5 py-3">
      <div className="rounded-lg border border-primary/30 bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldQuestion className="size-4 shrink-0 text-primary-strong" aria-hidden="true" />
          <span className="text-xs font-semibold text-ink">
            {isAction ? "Approval needed" : "Your teammate needs your input"}
          </span>
          <Badge tone="running" dot>
            {isAction ? "action paused" : "waiting for you"}
          </Badge>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {approval.question}
        </p>

        {isAction && approval.toolName && (
          <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-sidebar px-3 py-2 text-[11px] leading-relaxed text-ink-muted scrollbar-slim">
            {approval.toolName}
            {approval.args ? `(${approval.args})` : ""}
          </pre>
        )}

        {!isAction && options.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((option) => (
              <Button
                key={option}
                size="sm"
                variant="soft"
                disabled={busy}
                onClick={() => submitAnswer(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-end gap-2">
          <Textarea
            label={isAction ? "Note (optional)" : "Your answer"}
            rows={2}
            maxLength={4000}
            placeholder={
              isAction
                ? "Anything the teammate should know before it runs…"
                : "Type your reply — it goes straight back into the running task."
            }
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-w-0 flex-1"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isAction ? (
            <>
              <Button
                size="sm"
                icon={Check}
                loading={busy}
                disabled={busy}
                onClick={() => submitDecision(true)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={X}
                disabled={busy}
                onClick={() => submitDecision(false)}
              >
                Reject
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              loading={busy}
              disabled={busy || !text.trim()}
              onClick={() => submitAnswer(text)}
            >
              Send answer
            </Button>
          )}

          <span className="text-[11px] text-ink-muted">
            The task continues exactly where it paused.
          </span>
        </div>

        {error && (
          <div className="mt-2 rounded-lg border border-error-ink/20 bg-error px-3 py-2 text-[11px] text-error-ink">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
