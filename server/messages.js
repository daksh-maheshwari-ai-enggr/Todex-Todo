import { prisma } from "./prisma.js";

const ALLOWED_ROLES = ["user", "assistant", "tool"];

// Matches the Message.content column limit in prisma/schema.prisma.
const MAX_CONTENT_LENGTH = 4000;

// Attach an HTTP status to service errors so routes can map them consistently.
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Helper function to validate message data
function validateMessageData(data) {
  const { content, role } = data || {};

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw httpError(400, "Content is required and must be a non-empty string.");
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw httpError(400, `Content exceeds the maximum length of ${MAX_CONTENT_LENGTH} characters.`);
  }

  if (!role || typeof role !== "string" || !ALLOWED_ROLES.includes(role.toLowerCase())) {
    throw httpError(400, "Role is required and must be one of: 'user', 'assistant', 'tool'.");
  }

  return {
    content: content.trim(),
    role: role.toUpperCase(), // Match the Prisma MessageRole enum
  };
}

// Ensure the chat exists and is owned by the given user.
async function assertChatOwnership(chatId, userId) {
  const chat = await prisma.chat.findFirst({
    where: { id: chatId, userId },
  });

  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
  }

  return chat;
}

// Create a new message
export async function createMessage(chatId, senderId, role, content) {
  const validatedData = validateMessageData({ content, role });

  // Public message creation only accepts user-authored messages.
  if (validatedData.role !== "USER") {
    throw httpError(400, "Only user messages are allowed.");
  }

  await assertChatOwnership(chatId, senderId);

  return prisma.message.create({
    data: {
      chatId,
      senderId,
      role: validatedData.role,
      content: validatedData.content,
    },
  });
}

// Trusted server-side helper used only by the chat-turn orchestration. It is
// intentionally not reachable from any public route: ASSISTANT/TOOL messages
// must never be creatable from client input. Assistant replies are stored
// against the authenticated chat owner because Message.senderId references User.
// `botId` optionally attributes the reply to the teammate that produced it.
// `client` lets trusted callers (the background job runner) include this write
// in a transaction with the job's terminal update; it defaults to the shared
// client so existing callers are unaffected.
export async function createAssistantMessage(chatId, senderId, content, botId = null, client = prisma) {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw httpError(400, "Assistant content must be a non-empty string.");
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw httpError(400, `Content exceeds the maximum length of ${MAX_CONTENT_LENGTH} characters.`);
  }

  return client.message.create({
    data: {
      chatId,
      senderId,
      role: "ASSISTANT",
      content: content.trim(),
      botId: botId || null,
    },
  });
}

// Trusted server-side helper for recording a tool result as conversation
// history. TOOL messages are agent working memory: they let a resumed or
// retried run see the work it already did instead of starting over. They are
// deliberately excluded from the chat transcript returned to clients (see
// findMessagesByChatId) because the user-facing record of a step is the
// ToolExecution row, not a chat bubble.
//
// The write is keyed by (chatId, toolCallId) so a re-executed graph node
// updates the same row instead of writing a duplicate tool result.
export async function createToolMessage(
  chatId,
  senderId,
  { content, toolCallId, botId = null },
  client = prisma,
) {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw httpError(400, "Tool content must be a non-empty string.");
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw httpError(400, `Content exceeds the maximum length of ${MAX_CONTENT_LENGTH} characters.`);
  }

  const data = {
    chatId,
    senderId,
    role: "TOOL",
    content: content.trim(),
    botId: botId || null,
    toolCallId: toolCallId || null,
  };

  if (!data.toolCallId) {
    return client.message.create({ data });
  }

  return client.message.upsert({
    where: { chatId_toolCallId: { chatId, toolCallId: data.toolCallId } },
    create: data,
    update: { content: data.content, botId: data.botId },
  });
}

// Find the complete conversation history for a chat the user owns.
//
// TOOL messages are excluded: they are the agent's working memory (loaded
// separately by memory.js), not part of the conversation the user reads.
export async function findMessagesByChatId(chatId, userId) {
  await assertChatOwnership(chatId, userId);

  return prisma.message.findMany({
    where: {
      chatId,
      role: { not: "TOOL" },
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

// Mark incoming messages (assistant/tool, i.e. not user-authored) as read.
// senderId cannot distinguish the parties because assistant replies are stored
// against the chat owner, so the MessageRole is the discriminator here.
export async function markMessagesAsRead(chatId, userId) {
  await assertChatOwnership(chatId, userId);

  return prisma.message.updateMany({
    where: {
      chatId,
      role: { in: ["ASSISTANT", "TOOL"] },
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });
}
