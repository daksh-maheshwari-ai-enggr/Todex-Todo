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
    role: role.toUpperCase(), // Ensure role is uppercase to match enum
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

  // Only allow USER role for public endpoints
  if (validatedData.role !== "USER") {
    throw new Error("Only user messages are allowed.");
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
export async function findMessagesByChatId(chatId, userId) {
  return prisma.message.findMany({
    where: {
      chatId,
      senderId: userId, // Only return messages from the user
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
        } // Only return minimal sender info
      },
    },
  });
}

// Mark messages as read
export async function markMessagesAsRead(chatId, userId) {
  return prisma.message.updateMany({
    where: {
      chatId,
      senderId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });
}