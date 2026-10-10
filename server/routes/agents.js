import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";
import { agentGraph } from "./agent.js";

const router = Router();

// Helper function to validate bot ownership
async function validateBotOwnership(botId, userId) {
  const bot = await prisma.bot.findUnique({
    where: {
      id: botId,
      userId,
    },
  });
  if (!bot) {
    throw new Error("Bot not found or does not belong to the authenticated user.");
  }
  return bot;
}

// Helper function to validate chat existence
async function validateChatExistence(chatId, userId) {
  const chat = await prisma.chat.findUnique({
    where: {
      id: chatId,
      userId,
    },
  });
  if (!chat) {
    throw new Error("Chat not found or does not belong to the authenticated user.");
  }
  return chat;
}

router.post("/:botId/respond", requireAuth, async (req, res) => {
  const { botId } = req.params;
  const { chatId, message } = req.body || {}

  try {
    // Validate bot ownership
    await validateBotOwnership(botId, req.user.id);

    // Validate chat existence
    const chat = await validateChatExistence(chatId, req.user.id);

    // Extract bot job and instructions
    const bot = await prisma.bot.findUnique({
      where: {
        id: botId,
      },
    });

    // Initialize agent state
    const initialState: any = {
      chatId,
      botId,
      botJob: bot.job,
      botInstructions: bot.instructions || "",
      conversationHistory: [],
      currentPrompt: "",
    };

    // Add user message to conversation history
    const updatedState = {
      ...initialState,
      conversationHistory: [...initialState.conversationHistory, {
        role: "user",
        content: message,
      }],
      currentPrompt: `${initialState.currentPrompt}${message}\nASSISTANT: `,
    };

    // Execute agent workflow
    const result = await execute(agentGraph, updatedState, { message });

    // Return assistant response
    res.json({
      response: result.response,
    });
  } catch (error) {
    console.error("Error in agent response:", error.message);
    res.status(500).json({
      error: "Failed to generate agent response.",
    });
  }
});

export default router;