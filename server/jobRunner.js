import { prisma } from "./prisma.js";
import { config } from "./config.js";
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
//
// `resumeApprovalId` marks a resumed run: the approval was already resolved by
// the owner (respondApproval), and this attempt continues the same job from the
// synthetic tool call/result pair built from that approval instead of starting
// a fresh turn.
//
// Crash safety (ROADMAP.md Phase B): every attempt re-reads the chat history,
// which now includes the TOOL messages of the tool rounds that already ran, so a
// retry or a re-dispatch continues the task instead of repeating completed work.
// The user message saved by an earlier attempt is reused, and the job's
// lifetime step budget is decremented rather than reset.

// Matches the AiJob.result column limit in prisma/schema.prisma.
const MAX_RESULT_LENGTH = 4000;

function jobError(status, message, retryable = false) {
  const error = new Error(message);
  error.status = status;
  error.retryable = retryable;
  return error;
}

export async function runAiJob({ jobId, attemptCount = null, resumeApprovalId = null }) {
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

  // A job already parked on an unanswered approval must not be restarted as a
  // fresh turn. That happens when a run died badly enough to be retried after
  // it had already paused: re-running it would redo the work and raise a second
  // approval for the same question. The parked state stands until the owner
  // answers, which dispatches a dedicated resume run.
  if (job.status === "WAITING_FOR_USER" && !resumeApprovalId) {
    return {
      ok: true,
      waitingForUser: true,
      jobId: job.id,
      status: "WAITING_FOR_USER",
      approvalId: job.lastApprovalId ?? null,
    };
  }

  // Load and validate the approval this run resumes from BEFORE the job is
  // marked running, so an invalid resume can never leave the job parked in
  // RUNNING with no attempt behind it. The approval must belong to this job and
  // must already be resolved — a still-pending one means the response never
  // landed and the run must not continue past the gate.
  let resumeApproval = null;
  if (resumeApprovalId) {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: resumeApprovalId, aiJobId: job.id },
    });
    if (!approval) {
      throw jobError(404, "The approval for this job no longer exists.");
    }
    if (approval.status === "PENDING") {
      throw jobError(409, "The approval has not been answered yet.");
    }
    if (approval.status !== "APPROVED" && approval.status !== "REJECTED") {
      throw jobError(409, "The approval is no longer resumable.");
    }
    resumeApproval = approval;
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

  // Run the turn through the shared orchestration. The only job-specific
  // behaviour is the finalize step, which commits in one transaction:
  //   * paused  -> question message + approval link + WAITING_FOR_USER (never a
  //                terminal status, so retries/reconciliation cannot eat it)
  //   * success -> assistant reply + chat timestamp + SUCCEEDED
  // A crash can therefore never leave a persisted reply against a still-running
  // job, and a retry can never write a second reply.
  // Remaining lifetime step budget. The per-attempt tool budget is capped by
  // what is left of the job's whole-life allowance, so pauses and retries can
  // never buy more steps. Zero is passed through as a real budget: the run
  // finalizes immediately with an honest summary instead of starting new work.
  const remainingSteps = Math.max(
    0,
    config.job.maxSteps - (job.stepCount ?? 0),
  );

  const { assistantMessage, pendingApproval } = await runChatTurn({
    bot,
    chat,
    userId: job.userId,
    message: job.message,
    participants,
    userMessage,
    aiJobId: job.id,
    resumeApproval,
    maxToolCalls: Math.min(config.agent.maxToolCallsJob, remainingSteps),
    timeoutMs: config.job.maxDurationMs,
    persistAssistant: async ({ chat: turnChat, userId: ownerId, bot: turnBot, response, pendingApproval: pause }) =>
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

        if (pause) {
          // Park the job on the approval: link both sides and keep it active.
          await tx.approvalRequest.update({
            where: { id: pause.id },
            data: { assistantMessageId: assistant.id },
          });

          const parked = await tx.aiJob.updateMany({
            where: {
              id: job.id,
              status: { notIn: ["CANCELLED", "FAILED", "SUCCEEDED"] },
            },
            data: {
              status: "WAITING_FOR_USER",
              assistantMessageId: assistant.id,
              lastApprovalId: pause.id,
              waitSince: new Date(),
              result: null,
              error: null,
              completedAt: null,
            },
          });

          if (parked.count === 0) {
            throw jobError(409, "Job was cancelled before it could pause.");
          }

          return assistant;
        }

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

  // Parked on a human approval: this attempt ends successfully from Trigger's
  // point of view while the application job stays WAITING_FOR_USER until the
  // approval is answered (then a fresh resume run continues it).
  if (pendingApproval) {
    return {
      ok: true,
      waitingForUser: true,
      jobId: job.id,
      status: "WAITING_FOR_USER",
      approvalId: pendingApproval.id,
    };
  }

  return {
    ok: true,
    jobId: job.id,
    status: "SUCCEEDED",
    result: assistantMessage.content,
  };
}
