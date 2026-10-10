import { prisma } from "./prisma.js";

// Create a new bot with automatic avatar seed generation
// Avatar seed is generated as a random string of 6 alphanumeric characters
// This ensures consistent generation on the backend while allowing frontend to use it

export async function createBot(data) {
  const avatarSeed = Math.random().toString(36).substring(2, 8);
  return prisma.bot.create({
    data: {
      ...data,
      avatar: avatarSeed,
    },
  });
}

export async function findBotsByUserId(userId) {
  return prisma.bot.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function findBotById(id) {
  return prisma.bot.findUnique({ where: { id } });
}

export async function findBotByIdAndUserId(id, userId) {
  return prisma.bot.findFirst({
    where: { id, userId },
  });
}

export async function updateBot(id, userId, data) {
  // Verify the bot exists and belongs to the user
  const existingBot = await prisma.bot.findFirst({
    where: { id, userId },
  });

  if (!existingBot) {
    return null;
  }

  return prisma.bot.update({
    where: { id },
    data,
  });
}

export async function deleteBot(id, userId) {
  // Verify the bot exists and belongs to the user
  const existingBot = await prisma.bot.findFirst({
    where: { id, userId },
  });

  if (!existingBot) {
    return null;
  }

  return prisma.bot.delete({ where: { id } });
}