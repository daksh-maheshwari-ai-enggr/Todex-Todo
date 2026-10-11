import { Hash, Server, Users } from "lucide-react";
import Avatar from "../ui/Avatar.jsx";
import Badge from "../ui/Badge.jsx";

export default function ChatHeader({ chat, teammate, participants = [], actions }) {
  const isGroup = !chat?.botId;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-card px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {teammate ? (
          <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="lg" />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong">
            <Users className="size-4" aria-hidden="true" />
          </span>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-ink">{chat?.title ?? "Conversation"}</h2>
            <Badge tone={isGroup ? "idle" : "neutral"}>
              {isGroup ? (
                <>
                  <Users className="size-2.5" aria-hidden="true" />
                  Group · {participants.length}
                </>
              ) : (
                "Direct"
              )}
            </Badge>
          </div>

          <p className="mt-0.5 truncate text-[11px] text-ink-muted">
            {teammate
              ? `${teammate.name} · ${teammate.job ?? "Teammate"}`
              : "Select a teammate to reply"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {teammate && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sidebar px-2.5 py-1 font-mono text-[10px] text-ink-muted"
            title={
              teammate.sandboxId
                ? `Daytona sandbox id: ${teammate.sandboxId}`
                : "This teammate has no Daytona sandbox yet. One is created the first time it runs a sandbox tool."
            }
          >
            <Server className="size-3" aria-hidden="true" />
            {teammate.sandboxId ? `${teammate.sandboxId.slice(0, 12)}…` : "no sandbox"}
          </span>
        )}

        {chat?.id && (
          <span className="hidden items-center gap-1 rounded-full border border-line bg-sidebar px-2.5 py-1 font-mono text-[10px] text-ink-muted sm:inline-flex">
            <Hash className="size-3" aria-hidden="true" />
            {chat.id.slice(0, 8)}
          </span>
        )}

        {actions}
      </div>
    </div>
  );
}
