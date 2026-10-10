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
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const message = await createMessage(chatId, req.user.id, role, content);
    res.status(201).json({ message });
  } catch (error) {
    console.error("Error creating message:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const messages = await findMessagesByChatId(chatId);
    res.json({ messages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.patch("/:chatId/read", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const updatedCount = await markMessagesAsRead(chatId, req.user.id);
    res.json({
      success: true,
      updatedCount: updatedCount.count,
    });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

export default router;