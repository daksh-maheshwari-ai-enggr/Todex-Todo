import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";
import { config } from "../config.js";
import {
  listPendingApprovals,
  respondApproval,
  toPublicApproval,
} from "../approvals.js";
import { getChatParticipantsForAgent } from "../chats.js";
import { runChatTurn } from "../chatTurn.js";
import { runAiJob } from "../jobRunner.js";
import { findJobForUser } from "../jobs.js";
import { resumeBackgroundJob } from "../backgroundJobs.js";

// Human-in-the-loop approvals (ROADMAP.md Phase A).
//
//   GET  /api/approvals?chatId=       pending cards for a chat
//   POST /api/approvals/:id/respond   answer/approve/reject, then resume the
//                                     paused run (background dispatch when the
//                                     job ran through Trigger.dev, otherwise
//                                     inline)
//
// Ownership is enforced inside the services for every step; nothing here trusts
// ids beyond routing.

const router = Router();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

router.get("/", requireAuth, async (req, res) => {
  const { chatId } = req.query || {};
  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required." });
  }

  try {
    const approvals = await listPendingApprovals({ chatId, userId: req.user.id });
    res.json({ approvals });
  } catch (error) {
    sendError(res, error, "Failed to load approvals.");
  }
});

// Resolve the teammate + chat for resuming a synchronous (non-job) turn,
// mirroring the ownership rules of POST /api/agents/:botId/respond.
async function resolveSyncContext({ userId, approval }) {
  const chat = await prisma.chat.findFirst({ where: { id: approval.chatId, userId } });
  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
  }

  const botId = approval.botId || chat.botId;
  if (!botId) {
    throw httpError(404, "No teammate is associated with this approval.");
  }

  const bot = await prisma.bot.findFirst({ where: { id: botId, userId } });
  if (!bot) {
    throw httpError(404, "Teammate not found or does not belong to the authenticated user.");
  }

  let participants;
  if (chat.botId) {
    if (chat.botId !== bot.id) {
      throw httpError(404, "Chat not found or does not belong to this teammate.");
    }
    participants = [bot];
  } else {
    participants = await getChatParticipantsForAgent(chat);
    if (!participants.some((participant) => participant.id === bot.id)) {
      throw httpError(404, "Teammate is not a participant in this chat.");
    }
  }

  return { bot, chat, participants };
}

router.post("/:id/respond", requireAuth, async (req, res) => {
  const { answer, approved, note } = req.body || {};

  try {
    // 1. Persist the response (validates ownership, PENDING state and expiry)
    //    and record it as a real user message in the chat.
    const approval = await respondApproval({
      approvalId: req.params.id,
      userId: req.user.id,
      answer,
      approved,
      note,
    });

    // 2. Resume the paused run with the resolved approval.
    let resumed = null;
    let response = null;

    if (approval.aiJobId) {
      const job = await findJobForUser(approval.aiJobId, req.user.id);
      if (!job) {
        throw httpError(404, "The job for this approval no longer exists.");
      }

      if (config.triggerDev.enabled && job.runId) {
        // Durable path: a fresh Trigger.dev run continues the same job.
        resumed = await resumeBackgroundJob({ userId: req.user.id, job, approval });
      } else {
        // No Trigger.dev (or the job never dispatched): continue inline. The
        // runner itself has no Trigger dependency, so this is the same code
        // path the worker would execute.
        const result = await runAiJob({ jobId: job.id, resumeApprovalId: approval.id });
        resumed = result;
        response =
          typeof result?.result === "string" && result.result ? result.result : null;
      }
    } else {
      // Synchronous turn: continue inline and return the continuation reply.
      const { bot, chat, participants } = await resolveSyncContext({
        userId: req.user.id,
        approval,
      });

      const turn = await runChatTurn({
        bot,
        chat,
        userId: req.user.id,
        message: "",
        participants,
        resumeApproval: approval,
      });

      response = turn.pendingApproval
        ? turn.pendingApproval.question
        : (turn.assistantMessage?.content ?? null);
    }

    res.json({ approval: toPublicApproval(approval), resumed, response });
  } catch (error) {
    sendError(res, error, "Failed to respond to the approval.");
  }
});

export default router;
