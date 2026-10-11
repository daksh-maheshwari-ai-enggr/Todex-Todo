import { prisma } from "./prisma.js";
import { generateAgentResponse } from "./agent.js";
import { createMessage, createAssistantMessage } from "./messages.js";
import { loadConversationContext } from "./memory.js";

// Default persistence for a finished turn: store the assistant reply, then bump
// the chat's updatedAt. Used by the synchronous respond endpoint. Background
// job execution substitutes a transactional version so the reply and the job's
// terminal status are recorded atomically.
async function defaultPersistAssistant({ chat, userId, bot, response }) {
  const assistantMessage = await createAssistantMessage(chat.id, userId, response, bot.id);

  await prisma.chat.update({
    where: { id: chat.id },
    data: { updatedAt: new Date() },
  });

  return assistantMessage;
}

// Execute one complete authenticated chat turn:
//   1. persist the user's message
//   2. load the existing history (which now includes that message)
//   3. generate the assistant reply through the LangGraph agent
//   4. persist the assistant reply and bump the chat's updatedAt
//
// Kept separate from the Express route and from the agent/graph itself. The
// caller is responsible for validating ownership of the bot and chat.
//
// `userMessage` lets a retried background attempt reuse the message saved by an
// earlier attempt instead of writing it again. `persistAssistant` lets the
// background runner commit the reply together with the job's terminal state.
export async function runChatTurn({
  bot,
  chat,
  userId,
  message,
  participants = [],
  userMessage = null,
  persistAssistant = defaultPersistAssistant,
}) {
  // 1. Persist the user message first. createMessage enforces the USER role.
  const savedUserMessage = userMessage ?? (await createMessage(chat.id, userId, "user", message));

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
      chatId: chat.id,
      botId: bot.id,
      participants,
      botJob: bot.job,
      botInstructions: bot.instructions || "",
      conversationHistory,
      message: savedUserMessage.content,
    });
  } catch (error) {
    error.userMessage = savedUserMessage;
    error.isProviderError = true;
    throw error;
  }

  if (!response || response.trim().length === 0) {
    const error = new Error("The AI provider returned an empty response.");
    error.userMessage = savedUserMessage;
    error.isProviderError = true;
    throw error;
  }

  // 4. Persist the assistant reply only after successful generation. A failure
  //    here still returns the saved user message to the caller so it is never
  //    lost, exactly like a generation failure.
  let assistantMessage;
  try {
    assistantMessage = await persistAssistant({ chat, userId, bot, response });
  } catch (error) {
    error.userMessage = savedUserMessage;
    throw error;
  }

  return { userMessage: savedUserMessage, assistantMessage };
}
