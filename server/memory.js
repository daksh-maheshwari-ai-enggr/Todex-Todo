import { prisma } from "./prisma.js";
import { config } from "./config.js";

// A persisted TOOL message is only usable as context when it can be paired with
// the tool call it answers: providers reject a tool result whose tool_call_id
// matches no assistant tool_call. The call itself (name and arguments) lives on
// the ToolExecution row, so a TOOL message with no matching execution is an
// orphan and is dropped rather than sent to the model.
function attachToolCalls(messages, executions) {
  const byCallId = new Map(
    (executions || [])
      .filter((execution) => execution.toolCallId)
      .map((execution) => [execution.toolCallId, execution]),
  );

  const usable = [];
  for (const message of messages) {
    if (String(message.role || "").toUpperCase() !== "TOOL") {
      usable.push(message);
      continue;
    }

    const execution = message.toolCallId ? byCallId.get(message.toolCallId) : null;
    if (!execution) continue;

    usable.push({
      ...message,
      toolName: execution.toolName,
      toolArgs: execution.args,
    });
  }

  return usable;
}

// Load a bounded, chronologically ordered slice of a chat's conversation
// history to use as agent context.
//
// The persisted Message rows remain the single source of truth; this only
// limits how much of that history is fed to the model. History is isolated per
// chat, and the chat is re-checked to belong to the authenticated user so one
// user can never read another user's conversation.
//
// Tool results are part of that history: a retried or resumed run must be able
// to see the work it already completed. They arrive as { role: "TOOL" } entries
// enriched with the tool name/arguments of the call they answer.
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
    select: { id: true, role: true, content: true, toolCallId: true },
  });

  recent.reverse();

  // Resolve the calls behind the tool results in this window in one query.
  const toolCallIds = recent
    .filter(
      (message) =>
        String(message.role || "").toUpperCase() === "TOOL" && message.toolCallId,
    )
    .map((message) => message.toolCallId);

  const executions = toolCallIds.length
    ? await prisma.toolExecution.findMany({
        where: { chatId, toolCallId: { in: toolCallIds } },
        select: { toolCallId: true, toolName: true, args: true },
      })
    : [];

  return attachToolCalls(recent, executions);
}
