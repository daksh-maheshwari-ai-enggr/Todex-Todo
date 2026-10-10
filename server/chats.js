import { prisma } from "./prisma.js";
import { config } from "./config.js";

// Minimal bot fields returned to clients / listed to the agent.
const BOT_PUBLIC_SELECT = { id: true, name: true, avatar: true, job: true };

// Attach an HTTP status to service errors so routes can map them consistently.
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Helper function to validate chat data
function validateChatData(data) {
  const { title } = data || {}
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    throw httpError(400, "Title is required and must be a non-empty string.");
  }
  const trimmed = title.trim();
  if (trimmed.length > 100) {
    throw httpError(400, "Title exceeds the maximum length of 100 characters.");
  }
  return { title: trimmed }
}

// Create a new chat
export async function createChat(userId, botId, title) {
  const validatedData = validateChatData({ title });

  // Verify bot ownership if botId is provided
  const bot = botId ? await prisma.bot.findFirst({
    where: { id: botId, userId: userId } // Ensure bot belongs to the user
  }) : null;

  if (botId && !bot) {
    throw httpError(404, "Bot not found or does not belong to the authenticated user.");
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
  return prisma.chat.findFirst({
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

  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
  });

  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
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
  const chat = await prisma.chat.findFirst({
    where: {
      id: chatId,
      userId,
    },
  });

  if (!chat) {
    throw httpError(404, "Chat not found or does not belong to the authenticated user.");
  }

  return prisma.chat.delete({
    where: {
      id: chatId,
    },
  });
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

// Create a group chat with an initial set of owned teammate participants.
export async function createGroupChat(userId, title, botIds) {
  const validatedData = validateChatData({ title });

  if (!Array.isArray(botIds) || botIds.length === 0) {
    throw httpError(400, "botIds must be a non-empty array of bot ids.");
  }

  const uniqueBotIds = [...new Set(botIds)];
  if (uniqueBotIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw httpError(400, "Every bot id must be a non-empty string.");
  }

  if (uniqueBotIds.length > config.groupChats.maxParticipants) {
    throw httpError(
      400,
      `A group chat can have at most ${config.groupChats.maxParticipants} teammates.`,
    );
  }

  // Every bot added must belong to the authenticated user.
  const bots = await prisma.bot.findMany({
    where: { id: { in: uniqueBotIds }, userId },
  });

  if (bots.length !== uniqueBotIds.length) {
    throw httpError(
      404,
      "One or more bots were not found or do not belong to the authenticated user.",
    );
  }

  return prisma.chat.create({
    data: {
      userId,
      title: validatedData.title,
      botId: null,
      participants: {
        create: uniqueBotIds.map((botId) => ({ botId })),
      },
    },
    include: {
      participants: { include: { bot: { select: BOT_PUBLIC_SELECT } } },
    },
  });
}

// List a chat's participants (group chats) for the owning user.
export async function listParticipants(chatId, userId) {
  await assertChatOwnership(chatId, userId);

  return prisma.chatParticipant.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    include: { bot: { select: BOT_PUBLIC_SELECT } },
  });
}

// Add a bot the user owns to a group chat.
export async function addParticipant(chatId, userId, botId) {
  await assertChatOwnership(chatId, userId);

  if (typeof botId !== "string" || botId.length === 0) {
    throw httpError(400, "botId is required and must be a non-empty string.");
  }

  const bot = await prisma.bot.findFirst({ where: { id: botId, userId } });
  if (!bot) {
    throw httpError(404, "Bot not found or does not belong to the authenticated user.");
  }

  const count = await prisma.chatParticipant.count({ where: { chatId } });
  if (count >= config.groupChats.maxParticipants) {
    throw httpError(
      400,
      `A group chat can have at most ${config.groupChats.maxParticipants} teammates.`,
    );
  }

  return prisma.chatParticipant.upsert({
    where: { chatId_botId: { chatId, botId } },
    create: { chatId, botId },
    update: {},
    include: { bot: { select: BOT_PUBLIC_SELECT } },
  });
}

// Remove a participant from a group chat.
export async function removeParticipant(chatId, userId, botId) {
  await assertChatOwnership(chatId, userId);

  const result = await prisma.chatParticipant.deleteMany({ where: { chatId, botId } });
  if (result.count === 0) {
    throw httpError(404, "Participant not found in this chat.");
  }

  return { removed: result.count };
}

// Resolve the teammate bots that may participate in a chat: the single bot of a
// direct chat, or the participants of a group chat. Used to build trusted agent
// context (never derived from the model).
export async function getChatParticipantsForAgent(chat) {
  if (chat.botId) {
    const bot = await prisma.bot.findUnique({ where: { id: chat.botId } });
    return bot ? [bot] : [];
  }

  const rows = await prisma.chatParticipant.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: "asc" },
    include: { bot: true },
  });

  return rows.map((row) => row.bot);
}