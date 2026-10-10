import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";

// Helper function to validate message data
function validateMessageData(data) {
  const { content, role } = data || {}

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Content is required and must be a non-empty string.");
  }

  if (!role || !["user", "assistant", "tool"].includes(role)) {
    throw new Error("Role is required and must be one of: 'user', 'assistant', 'tool'");
  }

  return {
    content: content.trim(),
    role,
  }
}

// Create a new message
export async function createMessage(chatId, senderId, role, content) {
  const validatedData = validateMessageData({ content, role });

  // Verify chat ownership
  const chat = await prisma.chat.findUnique({
    where: {
      id: chatId,
      userId: senderId, // Only allow messages from users who own the chat
    },
  });

  if (!chat) {
    throw new Error("Chat not found or does not belong to the sender.");
  }

  return prisma.message.create({
    data: {
      chatId,
      senderId,
      role: validatedData.role,
      content: validatedData.content,
    },
  });
}

// Find messages for a chat
export async function findMessagesByChatId(chatId) {
  return prisma.message.findMany({
    where: {
      chatId,
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      sender: true,
    },
  });
}

// Mark messages as read
export async function markMessagesAsRead(chatId, senderId) {
  return prisma.message.updateMany({
    where: {
      chatId,
      senderId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });
}