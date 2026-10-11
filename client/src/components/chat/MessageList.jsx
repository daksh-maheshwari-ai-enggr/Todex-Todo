import { useEffect, useRef } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import MessageBubble from "./MessageBubble.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import Spinner from "../ui/Spinner.jsx";

export default function MessageList({
  messages = [],
  teammatesById = {},
  currentUserId,
  loading = false,
  error = null,
  pending = false,
  emptyTitle = "No messages yet",
  emptyDescription,
}) {
  const bottomRef = useRef(null);

  // Keep the newest message in view as the conversation grows or a reply arrives.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, pending]);

  if (loading && messages.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Spinner label="Loading conversation…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-0 flex-1 p-4">
        <EmptyState
          icon={MessageSquare}
          title="Could not load messages"
          description={error.message}
          note="Messages come from GET /api/messages/:chatId."
        />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        <EmptyState
          icon={MessageSquare}
          title={emptyTitle}
          description={emptyDescription}
          className="w-full max-w-lg"
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-slim">
      <ul className="mx-auto flex max-w-3xl flex-col gap-5">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            teammate={teammatesById[message.botId] ?? null}
            isOwn={message.senderId === currentUserId}
          />
        ))}

        {pending && (
          <li className="flex items-center gap-2 text-xs text-ink-muted">
            <Loader2 className="size-3.5 animate-spin-slow text-primary" aria-hidden="true" />
            Teammate is working…
          </li>
        )}
      </ul>
      <div ref={bottomRef} />
    </div>
  );
}
