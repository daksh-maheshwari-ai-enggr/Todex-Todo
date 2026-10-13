import { prisma } from "./prisma.js";
import { config } from "./config.js";

// A persisted TOOL message is only meaningful when paired with the assistant
// tool-call it answers. Tool results are not persisted today (only the final
// ASSISTANT reply is), so there should be no TOOL rows in stored history. If a
// bounded window ever starts on a TOOL row, it would be an orphan, so drop
// leading TOOL entries defensively rather than sending them to the model.
function dropLeadingOrphanedToolMessages(messages) {
  let start = 0;
  while (
    start < messages.length &&
    String(messages[start]?.role || "").toUpperCase() === "TOOL"
  ) {
    start += 1;
  }
  return start === 0 ? messages : messages.slice(start);
}

// Load a bounded, chronologically ordered slice of a chat's conversation
// history to use as agent context.
//
// The persisted Message rows remain the single source of truth; this only
// limits how much of that history is fed to the model. History is isolated per
// chat, and the chat is re-checked to belong to the authenticated user so one
// user can never read another user's conversation.
export async function loadConversationContext({
  chatId,
  userId,
  maxMessages = config.memory.maxHistoryMessages,
}) {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId } });
  if (!chat) {
    const error = new Error(
      "Chat not found or does not belong to the authenticated user.",
    );
    error.status = 404;
    throw error;
  }

  // Always keep at least the most recent message (the current user message,
  // which is the newest row), so it can never be dropped by the window.
  const limit = Math.max(1, Number(maxMessages) || config.memory.maxHistoryMessages);

  // Take the most recent `limit` messages, then reverse into chronological
  // order so the agent sees oldest -> newest. Ids are included so a resume can
  // exclude the approval-response message (which is re-fed as the deferred tool
  // result instead of appearing twice in the context).
  const recent = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, role: true, content: true },
  });

  recent.reverse();
  return dropLeadingOrphanedToolMessages(recent);
}
