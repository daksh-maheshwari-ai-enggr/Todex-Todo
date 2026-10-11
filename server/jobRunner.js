import { prisma } from "./prisma.js";
import { runChatTurn } from "./chatTurn.js";
import { getChatParticipantsForAgent } from "./chats.js";
import { createMessage, createAssistantMessage } from "./messages.js";
import {
  findJobById,
  markJobRunning,
  setJobUserMessage,
} from "./jobs.js";

// Narrow background execution entry point for a durable AI job.
//
// This is deliberately the ONLY place that runs an agent turn on behalf of a
// background job. It reuses the same services as the synchronous respond
// endpoint (chatTurn orchestration, the LangGraph agent, the tool registry, the
// Daytona sandbox service, the handoff runner) instead of introducing a second
// agent loop, so tool-call limits, graph recursion limits, handoff depth and
// timeout budgets are all inherited unchanged.
//
// It has no Trigger.dev dependency: the task definition in trigger/ai-job.js
// decides retry policy and owns the failure hooks. `jobId` is the only input,
// and every piece of trusted context (owner, chat, teammate, message) is loaded
// from the database rather than trusted from a payload.

// Matches the AiJob.result column limit in prisma/schema.prisma.
const MAX_RESULT_LENGTH = 4000;

function jobError(status, message, retryable = false) {
  const error = new Error(message);
  error.status = status;
  error.retryable = retryable;
  return error;
}

export async function runAiJob({ jobId, attemptCount = null }) {
  if (!jobId || typeof jobId !== "string") {
    throw jobError(400, "A job id is required.");
  }

  const job = await findJobById(jobId);
  if (!job) {
    throw jobError(404, "Job not found.");
  }

  // Idempotent re-entry. A retried attempt must never re-run the agent or write
  // more chat messages once the job has already produced its result.
  if (job.status === "SUCCEEDED" && job.result) {
    return {
      ok: true,
      alreadyCompleted: true,
      jobId: job.id,
      status: job.status,
      result: job.result,
    };
  }

  if (job.status === "CANCELLED" || job.status === "FAILED") {
    return { ok: false, jobId: job.id, status: job.status, error: job.error ?? null };
  }

  const running = await markJobRunning({ jobId: job.id, attemptCount });
  if (running && running.status === "CANCELLED") {
    return { ok: false, cancelled: true, jobId: job.id, status: "CANCELLED" };
  }

  // Re-verify the job's trusted context from the database on every attempt. The
  // owner, chat and teammate must still exist and still be related to each
  // other; a job recorded before a deletion must not be able to act.
  const bot = await prisma.bot.findFirst({ where: { id: job.botId, userId: job.userId } });
  if (!bot) {
    throw jobError(404, "The teammate for this job no longer exists.");
  }

  const chat = await prisma.chat.findFirst({ where: { id: job.chatId, userId: job.userId } });
  if (!chat) {
    throw jobError(404, "The chat for this job no longer exists.");
  }

  // Resolve participants exactly like the synchronous path: the single bot of a
  // direct chat, or the validated participants of a group chat.
  let participants = [];
  if (chat.botId) {
    if (chat.botId !== bot.id) {
      throw jobError(404, "The teammate is not the bot of this chat.");
    }
    participants = [bot];
  } else {
    participants = await getChatParticipantsForAgent(chat);
    if (!participants.some((participant) => participant.id === bot.id)) {
      throw jobError(404, "The teammate is no longer a participant in this chat.");
    }
  }

  // Reuse the user message saved by an earlier attempt if there is one. This is
  // what makes a retry safe: the chat never gains a duplicate user message, and
  // the id is recorded before generation starts.
  let userMessage = job.userMessageId
    ? await prisma.message.findFirst({ where: { id: job.userMessageId, chatId: chat.id } })
    : null;

  if (!userMessage) {
    userMessage = await createMessage(chat.id, job.userId, "user", job.message);
    await setJobUserMessage({ jobId: job.id, userMessageId: userMessage.id });
  }

  // Run the turn through the shared orchestration. The only background-specific
  // behaviour is the finalize step: the assistant reply, the chat timestamp and
  // the job's terminal state are committed in one transaction so a crash can
  // never leave a persisted reply against a still-running job, and a retry can
  // never write a second reply.
  const { assistantMessage } = await runChatTurn({
    bot,
    chat,
    userId: job.userId,
    message: job.message,
    participants,
    userMessage,
    persistAssistant: async ({ chat: turnChat, userId: ownerId, bot: turnBot, response }) =>
      prisma.$transaction(async (tx) => {
        const assistant = await createAssistantMessage(
          turnChat.id,
          ownerId,
          response,
          turnBot.id,
          tx,
        );

        await tx.chat.update({
          where: { id: turnChat.id },
          data: { updatedAt: new Date() },
        });

        // Guarded write: a job cancelled mid-turn must not be resurrected into
        // SUCCEEDED, and in that case the whole transaction is rolled back so
        // the reply is not persisted either.
        const updated = await tx.aiJob.updateMany({
          where: { id: job.id, status: { not: "CANCELLED" } },
          data: {
            status: "SUCCEEDED",
            result:
              response.length > MAX_RESULT_LENGTH
                ? response.slice(0, MAX_RESULT_LENGTH)
                : response,
            assistantMessageId: assistant.id,
            error: null,
            completedAt: new Date(),
          },
        });

        if (updated.count === 0) {
          throw jobError(409, "Job was cancelled before it could complete.");
        }

        return assistant;
      }),
  });

  return {
    ok: true,
    jobId: job.id,
    status: "SUCCEEDED",
    result: assistantMessage.content,
  };
}
