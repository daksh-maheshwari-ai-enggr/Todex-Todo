import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createMessage,
  findMessagesByChatId,
  markMessagesAsRead,
} from "../messages.js";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  const { chatId, content, role } = req.body || {}

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "Content is required and must be a non-empty string." });
  }

  if (!role || !["user", "assistant", "tool"].includes(role.toLowerCase())) {
    return res.status(400).json({ error: "Role is required and must be one of: 'user', 'assistant', 'tool'" });
  }

  try {
    const message = await createMessage(chatId, role, content);
    res.status(201).json({ message });
  } catch (error) {
    console.error("Error creating message:", error.message);
    if (error.message.includes("Chat not found") || error.message.includes("does not belong")) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Failed to create message" });
    }
  }
});

router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  try {
    const messages = await findMessagesByChatId(chatId);
    res.json({ messages });
  } catch (error) {
    console.error("Error fetching messages:", error.message);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.patch("/:chatId/read", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  try {
    const updatedCount = await markMessagesAsRead(chatId);
    res.json({
      success: true,
      updatedCount: updatedCount.count,
    });
  } catch (error) {
    console.error("Error marking messages as read:", error.message);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

export default router;