import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";
import { MAX_MESSAGE_LENGTH } from "../agent.js";
import { runChatTurn } from "../chatTurn.js";

const router = Router();

// POST /api/agents/:botId/respond
// Runs one authenticated chat turn: persists the user message, generates an
// assistant reply and persists it. Requires a chat owned by the user and tied
// to the requested bot.
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

  if (!chatId || typeof chatId !== "string" || chatId.length === 0) {
    return res
      .status(400)
      .json({ error: "chatId is required and must be a non-empty string." });
  }

  // Load the bot and chat and verify ownership before any write happens.
  let bot;
  let chat;

  try {
    bot = await prisma.bot.findFirst({
      where: { id: botId, userId: req.user.id },
    });

    if (!bot) {
      return res.status(404).json({ error: "Bot not found." });
    }

    // The chat must belong to the user AND be associated with this bot.
    chat = await prisma.chat.findFirst({
      where: { id: chatId, userId: req.user.id },
    });

    if (!chat || chat.botId !== botId) {
      return res.status(404).json({ error: "Chat not found or does not belong to this bot." });
    }
  } catch (error) {
    console.error("Error loading agent context:", error?.message);
    return res.status(500).json({ error: "Failed to load agent context." });
  }

  // Run the turn. Provider failures are reported without leaking internals, and
  // the already-saved user message is returned so the client can reconcile.
  try {
    const { userMessage, assistantMessage } = await runChatTurn({
      bot,
      chat,
      userId: req.user.id,
      message,
    });

    return res.status(201).json({
      response: assistantMessage.content,
      userMessage,
      assistantMessage,
    });
  } catch (error) {
    const userMessage = error?.userMessage;

    if (error?.isProviderError) {
      if (error?.name === "AbortError") {
        return res
          .status(504)
          .json({ error: "The AI provider request timed out.", userMessage });
      }
      console.error("Error generating agent response:", error?.message);
      return res
        .status(502)
        .json({ error: "Failed to generate agent response.", userMessage });
    }

    if (error?.status) {
      return res.status(error.status).json({ error: error.message, userMessage });
    }

    console.error("Error running chat turn:", error?.message);
    return res
      .status(500)
      .json({ error: "Failed to process chat turn.", userMessage });
  }
});

export default router;
