import { Bot, User } from "lucide-react";
import Avatar from "../ui/Avatar.jsx";
import { formatTime } from "../../utils/format.js";

// A single persisted message. Assistant messages are attributed to the teammate
// that produced them (`botId` is set by the backend for group chats).
export default function MessageBubble({ message, teammate, isOwn = false }) {
  const role = String(message.role || "").toUpperCase();
  const isUser = role === "USER";

  if (isUser) {
    return (
      <li className={`flex gap-3 ${isOwn ? "justify-end" : ""}`}>
        <div className="max-w-[80%]">
          <div className="flex items-center justify-end gap-2 text-[11px] text-ink-muted">
            <span>{formatTime(message.createdAt)}</span>
            <span className="font-medium text-ink">{message.sender?.name ?? "You"}</span>
            <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-primary-strong">
              <User className="size-3" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-1 rounded-card rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white">
            {message.content}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex gap-3">
      {teammate ? (
        <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="md" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong">
          <Bot className="size-4" aria-hidden="true" />
        </span>
      )}

      <div className="min-w-0 max-w-[80%]">
        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span className="font-medium text-ink">{teammate?.name ?? "Teammate"}</span>
          {teammate?.job && <span className="truncate">· {teammate.job}</span>}
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <div className="mt-1 rounded-card rounded-tl-sm border border-line bg-card px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink">
          {message.content}
        </div>
      </div>
    </li>
  );
}
