import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { generateAgentResponse } from "./agent.js";
import { createMessage, createAssistantMessage } from "./messages.js";
import { loadConversationContext } from "./memory.js";
import {
  activityTaskStarted,
  activityTaskCompleted,
  activityTaskBlocked,
} from "./activity.js";

// Default persistence for a finished turn: store the assistant reply, then bump
// the chat's updatedAt. Used by the synchronous respond endpoint. Background
// job execution substitutes a transactional version so the reply and the job's
// terminal status are recorded atomically.
//
// When the turn paused on a human approval, the visible reply is the approval
// question and is linked back onto the approval row so the card and the chat
// bubble reference each other.
async function defaultPersistAssistant({ chat, userId, bot, response, pendingApproval = null }) {
  const assistantMessage = await createAssistantMessage(chat.id, userId, response, bot.id);

  await prisma.chat.update({
    where: { id: chat.id },
    data: { updatedAt: new Date() },
  });

  if (pendingApproval) {
    try {
      await prisma.approvalRequest.update({
        where: { id: pendingApproval.id },
        data: { assistantMessageId: assistantMessage.id },
      });
    } catch (error) {
      console.warn("Failed to link approval to its question message:", error?.message);
    }
  }

  return assistantMessage;
}

// Execute one complete authenticated chat turn:
//   1. persist the user's message (skipped on a resume — the approval response
//      was persisted when the user answered)
//   2. load the existing history (which now includes that message)
//   3. generate the assistant reply through the LangGraph agent
//   4. persist the assistant reply and bump the chat's updatedAt
//
// The turn can also end PAUSED: the agent called ask_user or tripped the
// sensitive-action gate. Then `pendingApproval` is returned, the approval
// question is persisted as the visible reply, and neither the completed
// activity nor any terminal job status is recorded — a background job moves to
// WAITING_FOR_USER and resumes later from the approval response.
//
// Kept separate from the Express route and from the agent/graph itself. The
// caller is responsible for validating ownership of the bot and chat.
//
// `userMessage` lets a retried background attempt reuse the message saved by an
// earlier attempt instead of writing it again. `persistAssistant` lets the
// background runner commit the reply together with the job's terminal state.
// `aiJobId` links pauses raised during this turn to the background job, and
// `resumeApproval` restarts a previously paused run instead of starting fresh.
export async function runChatTurn({
  bot,
  chat,
  userId,
  message,
  participants = [],
  userMessage = null,
  persistAssistant = defaultPersistAssistant,
  aiJobId = null,
  resumeApproval = null,
}) {
  // 1. Persist the user message first. createMessage enforces the USER role.
  //    A resume never writes a new user message: the approval response already
  //    exists as one, and the turn continues the original request.
  const savedUserMessage = resumeApproval
    ? userMessage
    : userMessage ?? (await createMessage(chat.id, userId, "user", message));

  // 2. Load a bounded, chronological slice of the chat's history as agent
  //    context. It includes the message we just saved; the agent de-duplicates
  //    it against the current message. The full history is still persisted and
  //    remains the source of truth (trimming only affects what the model sees).
  const conversationHistory = await loadConversationContext({
    chatId: chat.id,
    userId,
  });

  // The turn has genuinely started: the user message is persisted and the agent
  // is about to run. Everything after this point is a real execution milestone.
  activityTaskStarted({
    chatId: chat.id,
    botId: bot.id,
    botName: bot.name,
    message: savedUserMessage?.content ?? "Resuming after the user's approval.",
  });

  // 3. Generate. On any generation failure, keep the saved user message and
  //    surface it to the caller so it can return a safe error without losing it.
  let result;
  try {
    result = await generateAgentResponse({
      userId,
      chatId: chat.id,
      botId: bot.id,
      participants,
      botJob: bot.job,
      botInstructions: bot.instructions || "",
      conversationHistory,
      message: savedUserMessage?.content ?? "",
      aiJobId,
      resumeApproval,
      maxToolCalls: aiJobId ? config.agent.maxToolCallsJob : config.agent.maxToolCallsSync,
    });
  } catch (error) {
    activityTaskBlocked({
      chatId: chat.id,
      botId: bot.id,
      reason: error?.message ?? "The agent run failed.",
    });
    error.userMessage = savedUserMessage;
    error.isProviderError = true;
    throw error;
  }

  const { text: response, pendingApproval } = result;

  if (!pendingApproval && (!response || response.trim().length === 0)) {
    const error = new Error("The AI provider returned an empty response.");
    activityTaskBlocked({ chatId: chat.id, botId: bot.id, reason: error.message });
    error.userMessage = savedUserMessage;
    error.isProviderError = true;
    throw error;
  }

  // On a pause the visible reply is the approval question itself.
  const replyText = pendingApproval ? pendingApproval.question : response;

  // 4. Persist the assistant reply only after successful generation. A failure
  //    here still returns the saved user message to the caller so it is never
  //    lost, exactly like a generation failure.
  let assistantMessage;
  try {
    assistantMessage = await persistAssistant({
      chat,
      userId,
      bot,
      response: replyText,
      pendingApproval,
    });
  } catch (error) {
    activityTaskBlocked({ chatId: chat.id, botId: bot.id, reason: error?.message });
    error.userMessage = savedUserMessage;
    throw error;
  }

  // A paused run is neither completed nor blocked: it is waiting for the human.
  // The approval event was already emitted when the approval row was created.
  if (pendingApproval) {
    return { userMessage: savedUserMessage, assistantMessage, pendingApproval };
  }

  activityTaskCompleted({ chatId: chat.id, botId: bot.id, summary: response });

  return { userMessage: savedUserMessage, assistantMessage };
}
