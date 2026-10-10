import { prisma } from "./prisma.js";

export async function createBot(data) {
  return prisma.bot.create({ data });
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

export async function updateBot(id, data) {
  return prisma.bot.update({
    where: { id },
    data,
  });
}

export async function deleteBot(id) {
  return prisma.bot.delete({ where: { id } });
}