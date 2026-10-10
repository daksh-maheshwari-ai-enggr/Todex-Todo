import { prisma } from "../prisma.js";

// Helper function to validate chat data
function validateChatData(data) {
  const { title } = data || {}
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    throw new Error("Title is required and must be a non-empty string.");
  }
  return { title: title.trim() }
}

// Create a new chat
export async function createChat(userId, botId, title) {
  const validatedData = validateChatData({ title });

  // Verify bot ownership if botId is provided
  const bot = botId ? await prisma.bot.findUnique({
    where: { id: botId, userId: userId } // Ensure bot belongs to the user
  }) : null;

  if (botId && !bot) {
    throw new Error("Bot not found or does not belong to the authenticated user.");
  }

  return prisma.chat.create({
    data: {
      userId,
      botId,
      title: validatedData.title,
    },
  });
}

// Find chats for a user
export async function findChatsByUserId(userId) {
  return prisma.chat.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      bot: true,
    },
  });
}

// Find a chat by ID and user ID
export async function findChatByIdAndUserId(chatId, userId) {
  return prisma.chat.findUnique({
    where: {
      id: chatId,
      userId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });
}

// Update a chat
export async function updateChat(chatId, userId, data) {
  const validatedData = validateChatData(data);

  const chat = await prisma.chat.findUnique({
    where: {
      id: chatId,
      userId,
    },
  });

  if (!chat) {
    throw new Error("Chat not found or does not belong to the authenticated user.");
  }

  return prisma.chat.update({
    where: {
      id: chatId,
    },
    data: {
      title: validatedData.title,
      updatedAt: new Date(),
    },
  });
}

// Delete a chat
export async function deleteChat(chatId, userId) {
  const chat = await prisma.chat.findUnique({
    where: {
      id: chatId,
      userId,
    },
  });

  if (!chat) {
    throw new Error("Chat not found or does not belong to the authenticated user.");
  }

  return prisma.chat.delete({
    where: {
      id: chatId,
    },
  });
}