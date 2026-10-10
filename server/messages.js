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
export async function createAssistantMessage(chatId, senderId, content, botId = null) {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw httpError(400, "Assistant content must be a non-empty string.");
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    throw httpError(400, `Content exceeds the maximum length of ${MAX_CONTENT_LENGTH} characters.`);
  }

  return prisma.message.create({
    data: {
      chatId,
      senderId,
      role: "ASSISTANT",
      content: content.trim(),
      botId: botId || null,
    },
  });
}

// Find the complete conversation history for a chat the user owns.
export async function findMessagesByChatId(chatId, userId) {
  await assertChatOwnership(chatId, userId);

  return prisma.message.findMany({
    where: {
      chatId,
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
