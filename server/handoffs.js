import { prisma } from "./prisma.js";

const MAX_TASK_LENGTH = 2000;
const MAX_RESULT_LENGTH = 4000;
const MAX_ERROR_LENGTH = 2000;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function truncate(value, maxLength) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : String(value);
  if (text.length === 0) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Persist the start of a teammate-to-teammate handoff. Ownership and
// participant validation happen in the caller (trusted server-side code).
export async function createHandoff({
  chatId,
  userId,
  fromBotId,
  toBotId,
  task,
  depth = 0,
  parentId = null,
  startedAt = new Date(),
}) {
  const text = typeof task === "string" ? task.trim() : "";
  if (!text) {
    throw httpError(400, "A handoff task is required.");
  }

  return prisma.handoff.create({
    data: {
      chatId,
      userId,
      fromBotId,
      toBotId,
      parentId,
      depth,
      task: text.slice(0, MAX_TASK_LENGTH),
      status: "RUNNING",
      startedAt,
    },
  });
}

// Finalize a handoff record with a bounded result or safe error message.
export async function finishHandoff({
  id,
  status,
  result,
  error,
  completedAt = new Date(),
}) {
  if (status !== "SUCCEEDED" && status !== "FAILED") {
    throw httpError(400, "Invalid handoff status.");
  }

  return prisma.handoff.update({
    where: { id },
    data: {
      status,
      result: truncate(result, MAX_RESULT_LENGTH),
      error: truncate(error, MAX_ERROR_LENGTH),
      completedAt,
    },
  });
}

// List the handoff history for a chat the authenticated user owns, oldest
// first, with a bounded page size and optional id-based cursor.
export async function listHandoffs(chatId, userId, { limit, cursor } = {}) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId },
  });

  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
  }

  const parsedLimit = Number(limit);
  const take = Math.min(
    Math.max(1, Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const handoffs = await prisma.handoff.findMany({
    where: { chatId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      fromBotId: true,
      toBotId: true,
      parentId: true,
      depth: true,
      task: true,
      status: true,
      result: true,
      error: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      fromBot: { select: { id: true, name: true } },
      toBot: { select: { id: true, name: true } },
    },
  });

  const hasMore = handoffs.length > take;
  const page = hasMore ? handoffs.slice(0, take) : handoffs;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { handoffs: page, nextCursor };
}
