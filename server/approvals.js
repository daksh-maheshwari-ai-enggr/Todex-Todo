import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { createMessage } from "./messages.js";
import {
  activityApprovalPending,
  activityApprovalResolved,
} from "./activity.js";

// Human-in-the-loop approval service (ROADMAP.md Phase A).
//
// An ApprovalRequest is the durable record of a paused agent run:
//   * QUESTION — created by the ask_user tool. The response is fed back to the
//     model as the deferred tool result when the run resumes.
//   * ACTION   — a gated tool call deferred before execution. Only an APPROVED
//     response lets the stored call run; REJECTED hands the reason back to the
//     model instead.
//
// Every operation is ownership-scoped to the authenticated user, and the
// activity event is emitted only after the database write actually succeeded.

const MAX_QUESTION_LENGTH = 2000;
const MAX_OPTIONS = 8;
const MAX_OPTION_LENGTH = 200;
const MAX_RESPONSE_LENGTH = 4000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function truncate(value, max) {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? text.slice(0, max) : text;
}

// Public shape sent to clients. The raw stored args stay server-side until the
// user opens the approval card (they are included so ACTION cards can show
// exactly what will run — they were authored by our own server, not the user).
export function toPublicApproval(approval) {
  if (!approval) return null;
  return {
    id: approval.id,
    chatId: approval.chatId,
    botId: approval.botId,
    aiJobId: approval.aiJobId,
    kind: approval.kind,
    question: approval.question,
    options: approval.options ? approval.options.split("\n").filter(Boolean) : [],
    toolName: approval.toolName,
    args: approval.args,
    status: approval.status,
    response: approval.response,
    createdAt: approval.createdAt,
    resolvedAt: approval.resolvedAt,
    expiresAt: approval.expiresAt,
  };
}

// Persist a new PENDING approval, link it to the paused job when there is one,
// and announce it on the chat's activity stream.
export async function createApproval({
  userId,
  chatId,
  botId = null,
  aiJobId = null,
  kind,
  question,
  options = [],
  toolName = null,
  toolCallId = null,
  args = null,
}) {
  if (kind !== "QUESTION" && kind !== "ACTION") {
    throw httpError(400, "Invalid approval kind.");
  }

  const trimmedQuestion = typeof question === "string" ? question.trim() : "";
  if (!trimmedQuestion) {
    throw httpError(400, "An approval requires a question.");
  }

  const optionLines = (Array.isArray(options) ? options : [])
    .map((option) => String(option).trim())
    .filter(Boolean)
    .slice(0, MAX_OPTIONS)
    .map((option) => truncate(option, MAX_OPTION_LENGTH));

  const approval = await prisma.approvalRequest.create({
    data: {
      userId,
      chatId,
      botId,
      aiJobId,
      kind,
      question: truncate(trimmedQuestion, MAX_QUESTION_LENGTH),
      options: optionLines.length ? optionLines.join("\n") : null,
      toolName,
      toolCallId,
      args,
      status: "PENDING",
      expiresAt: new Date(Date.now() + config.approvals.ttlMs),
    },
  });

  // Link the pause onto the job so the UI can jump straight to it. Failure
  // here must not lose the approval itself — the run is already paused on it.
  if (aiJobId) {
    try {
      await prisma.aiJob.update({
        where: { id: aiJobId },
        data: { lastApprovalId: approval.id, waitSince: new Date() },
      });
    } catch (error) {
      console.warn("Failed to link approval to job:", error?.message);
    }
  }

  activityApprovalPending({ chatId, botId, approval });
  return approval;
}

// Is a run currently paused on this chat? Used by the agent graph after each
// tool round to decide whether to stop instead of asking the model again.
export async function hasPendingApproval(chatId) {
  if (!chatId) return null;
  return prisma.approvalRequest.findFirst({
    where: { chatId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

// One pending approval for the chat, ownership-verified. Null when the chat
// does not belong to the user (404 via loadChatForUser below).
export async function listPendingApprovals({ chatId, userId }) {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, userId } });
  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
  }

  const approvals = await prisma.approvalRequest.findMany({
    where: { chatId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  return approvals.map(toPublicApproval);
}

// Load one approval for the authenticated owner. Null for both "missing" and
// "not yours" so callers cannot probe other users' approvals.
export async function findApprovalForUser(approvalId, userId) {
  if (!approvalId || typeof approvalId !== "string" || !userId) return null;
  return prisma.approvalRequest.findFirst({ where: { id: approvalId, userId } });
}

// Resolve a PENDING approval. The response is persisted as a real user chat
// message (so the conversation reads naturally); the resume path then feeds
// the same text back as the deferred tool result instead of re-reading it from
// history, so callers must exclude `responseMessageId` when rebuilding context.
export async function respondApproval({ approvalId, userId, answer, approved, note }) {
  const approval = await findApprovalForUser(approvalId, userId);
  if (!approval) {
    throw httpError(404, "Approval request not found.");
  }
  if (approval.status !== "PENDING") {
    throw httpError(409, "This approval request has already been resolved.");
  }
  if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: { status: "EXPIRED", resolvedAt: new Date() },
    });
    throw httpError(410, "This approval request has expired.");
  }

  let status;
  let response;

  if (approval.kind === "QUESTION") {
    const text = typeof answer === "string" ? answer.trim() : "";
    if (!text) {
      throw httpError(400, "answer is required to respond to a question.");
    }
    status = "APPROVED";
    response = truncate(text, MAX_RESPONSE_LENGTH);
  } else {
    if (typeof approved !== "boolean") {
      throw httpError(400, "approved (true or false) is required for an action approval.");
    }
    const noteText = typeof note === "string" ? note.trim() : "";
    status = approved ? "APPROVED" : "REJECTED";
    response = truncate(
      noteText || (approved ? "Approved." : "Rejected."),
      MAX_RESPONSE_LENGTH,
    );
  }

  // The visible record in the chat. createMessage enforces the USER role and
  // re-checks chat ownership.
  const message = await createMessage(approval.chatId, userId, "user", response);

  const updated = await prisma.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status,
      response,
      responseMessageId: message.id,
      resolvedAt: new Date(),
    },
  });

  activityApprovalResolved({
    chatId: approval.chatId,
    botId: approval.botId,
    approval: updated,
  });

  return updated;
}

// Assert that a *pending* approval justifies an action that reaches beyond the
// chat — currently browser takeover (ROADMAP.md Phase C). Taking the wheel is
// the human answering a real pause, never drive-by control of a teammate's
// browser, so the approval must still be open, owned by the caller, and (when
// the caller names a teammate) raised by that same teammate.
export async function requirePendingApproval({ approvalId, userId, botId = null }) {
  const approval = await findApprovalForUser(approvalId, userId);
  if (!approval) {
    throw httpError(404, "Approval request not found.");
  }

  if (approval.status !== "PENDING") {
    throw httpError(409, "This approval request has already been resolved.");
  }

  if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
    throw httpError(410, "This approval request has expired.");
  }

  if (botId && approval.botId && approval.botId !== botId) {
    throw httpError(403, "This approval belongs to a different teammate.");
  }

  return approval;
}

// Drop every pending approval of a run/chat — used when the run is cancelled
// so no card stays answerable for a run that will never resume.
export async function cancelPendingApprovals({ chatId = null, aiJobId = null, reason = null }) {
  if (!chatId && !aiJobId) return 0;

  const where = {
    status: "PENDING",
    ...(chatId ? { chatId } : {}),
    ...(aiJobId ? { aiJobId } : {}),
  };

  const result = await prisma.approvalRequest.updateMany({
    where,
    data: {
      status: "CANCELLED",
      response: truncate(reason || "Cancelled.", MAX_RESPONSE_LENGTH),
      resolvedAt: new Date(),
    },
  });
  return result.count;
}
