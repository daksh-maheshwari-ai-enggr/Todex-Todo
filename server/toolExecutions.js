import { prisma } from "./prisma.js";

// Size limits for stored debugging data. Keep only what is useful for
// inspecting execution activity; never store secrets.
const MAX_ARGS_LENGTH = 4000;
const MAX_RESULT_LENGTH = 4000;
const MAX_ERROR_LENGTH = 2000;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function toText(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value, maxLength) {
  const text = toText(value);
  if (text == null || text.length === 0) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Record the start of a tool execution.
//
// When a stable model tool-call id is available it is used to upsert, so a
// retried or re-executed graph node updates the same row instead of creating a
// duplicate record. Only safe, bounded fields are stored.
export async function startToolExecution({
  chatId,
  userId,
  toolName,
  toolCallId,
  args,
  aiJobId = null,
}) {
  const startedAt = new Date();
  const data = {
    chatId,
    userId,
    toolName,
    toolCallId: toolCallId || null,
    args: truncate(args, MAX_ARGS_LENGTH),
    status: "RUNNING",
    startedAt,
    aiJobId,
  };

  if (data.toolCallId) {
    return prisma.toolExecution.upsert({
      where: {
        chatId_toolCallId: { chatId, toolCallId: data.toolCallId },
      },
      create: data,
      update: {
        toolName: data.toolName,
        args: data.args,
        status: "RUNNING",
        startedAt,
        result: null,
        error: null,
        completedAt: null,
        durationMs: null,
        // Keep the job attribution of a re-executed call even when the retry
        // itself runs outside a job context.
        aiJobId: data.aiJobId ?? undefined,
      },
    });
  }

  return prisma.toolExecution.create({ data });
}

// Finalize a tool execution record. `error` holds the sanitized tool error
// message (no stack traces); `result` holds the sanitized success output.
export async function finishToolExecution({
  id,
  status,
  result,
  error,
  startedAt,
  completedAt = new Date(),
}) {
  if (status !== "SUCCEEDED" && status !== "FAILED") {
    throw httpError(400, "Invalid tool execution status.");
  }

  const started = startedAt ? new Date(startedAt) : null;
  const durationMs = started
    ? Math.max(0, completedAt.getTime() - started.getTime())
    : null;

  return prisma.toolExecution.update({
    where: { id },
    data: {
      status,
      result: truncate(result, MAX_RESULT_LENGTH),
      error: truncate(error, MAX_ERROR_LENGTH),
      completedAt,
      durationMs,
    },
  });
}

// List tool executions for a chat the user owns, oldest first, with a bounded
// page size and optional id-based cursor. Only safe fields are selected.
//
// Executions are attributed to the background job that ran them (aiJobId) when
// there is one; the job timeline reads them by that column (see jobs.js).
export async function listToolExecutions(chatId, userId, { limit, cursor } = {}) {
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

  const executions = await prisma.toolExecution.findMany({
    where: { chatId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      toolName: true,
      toolCallId: true,
      args: true,
      status: true,
      result: true,
      error: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      createdAt: true,
    },
  });

  const hasMore = executions.length > take;
  const page = hasMore ? executions.slice(0, take) : executions;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { executions: page, nextCursor };
}
