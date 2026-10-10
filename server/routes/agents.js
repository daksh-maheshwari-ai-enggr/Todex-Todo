import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";
import { generateAgentResponse, MAX_MESSAGE_LENGTH } from "../agent.js";

const router = Router();

// POST /api/agents/:botId/respond
// Generates an assistant response for a bot owned by the authenticated user.
router.post("/:botId/respond", requireAuth, async (req, res) => {
  const { botId } = req.params;
  const { chatId, message } = req.body || {};

  if (!botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid bot ID." });
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "message is required and must be a non-empty string." });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `message exceeds the maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
    });
  }

  if (chatId !== undefined && (typeof chatId !== "string" || chatId.length === 0)) {
    return res.status(400).json({ error: "chatId must be a non-empty string." });
  }

  // Load the bot and (optionally) the chat context.
  let bot;
  let conversationHistory = [];

  try {
    bot = await prisma.bot.findFirst({
      where: { id: botId, userId: req.user.id },
    });

    if (!bot) {
      return res.status(404).json({ error: "Bot not found." });
    }

    if (chatId) {
      // The chat must belong to the user AND be associated with this bot.
      const chat = await prisma.chat.findFirst({
        where: { id: chatId, userId: req.user.id },
      });

      if (!chat || chat.botId !== botId) {
        return res.status(404).json({ error: "Chat not found or does not belong to this bot." });
      }

      conversationHistory = await prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      });
    }
  } catch (error) {
    console.error("Error loading agent context:", error?.message);
    return res.status(500).json({ error: "Failed to load agent context." });
  }

  // Run the agent. Provider failures are reported without leaking details.
  try {
    const response = await generateAgentResponse({
      botJob: bot.job,
      botInstructions: bot.instructions || "",
      conversationHistory,
      message: message.trim(),
    });

    if (!response || response.trim().length === 0) {
      return res.status(502).json({ error: "The AI provider returned an empty response." });
    }

    return res.json({ response });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({ error: "The AI provider request timed out." });
    }
    console.error("Error generating agent response:", error?.message);
    return res.status(502).json({ error: "Failed to generate agent response." });
  }
});

export default router;
