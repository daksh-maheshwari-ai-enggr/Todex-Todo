import { prisma } from "./prisma.js";
import { generateAgentResponse } from "./agent.js";
import { createMessage, createAssistantMessage } from "./messages.js";
import { loadConversationContext } from "./memory.js";

// Execute one complete authenticated chat turn:
//   1. persist the user's message
//   2. load the existing history (which now includes that message)
//   3. generate the assistant reply through the LangGraph agent
//   4. persist the assistant reply and bump the chat's updatedAt
//
// Kept separate from the Express route and from the agent/graph itself. The
// caller is responsible for validating ownership of the bot and chat.
export async function runChatTurn({ bot, chat, userId, message }) {
  // 1. Persist the user message first. createMessage enforces the USER role.
  const userMessage = await createMessage(chat.id, userId, "user", message);

  // 2. Load a bounded, chronological slice of the chat's history as agent
  //    context. It includes the message we just saved; the agent de-duplicates
  //    it against the current message. The full history is still persisted and
  //    remains the source of truth (trimming only affects what the model sees).
  const conversationHistory = await loadConversationContext({
    chatId: chat.id,
    userId,
  });

  // 3. Generate. On any generation failure, keep the saved user message and
  //    surface it to the caller so it can return a safe error without losing it.
  let response;
  try {
    response = await generateAgentResponse({
      userId,
      botJob: bot.job,
      botInstructions: bot.instructions || "",
      conversationHistory,
      message: userMessage.content,
    });
  } catch (error) {
    error.userMessage = userMessage;
    error.isProviderError = true;
    throw error;
  }

  if (!response || response.trim().length === 0) {
    const error = new Error("The AI provider returned an empty response.");
    error.userMessage = userMessage;
    error.isProviderError = true;
    throw error;
  }

  // 4. Persist the assistant reply only after successful generation, then mark
  //    the turn complete by touching the chat's updatedAt.
  const assistantMessage = await createAssistantMessage(chat.id, userId, response);

  await prisma.chat.update({
    where: { id: chat.id },
    data: { updatedAt: new Date() },
  });

  return { userMessage, assistantMessage };
}
