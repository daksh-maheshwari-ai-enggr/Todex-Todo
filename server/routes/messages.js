import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createMessage,
  findMessagesByChatId,
  markMessagesAsRead,
} from "../messages.js";

const router = Router();

// Map a service error to an HTTP response without leaking internals.
function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

router.post("/", requireAuth, async (req, res) => {
  const { chatId, content, role } = req.body || {};

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "Content is required and must be a non-empty string." });
  }

  if (!role || typeof role !== "string") {
    return res.status(400).json({ error: "Role is required and must be one of: 'user', 'assistant', 'tool'." });
  }

  // Public message creation only accepts user-authored messages.
  if (role.toLowerCase() !== "user") {
    return res.status(400).json({ error: "Only user messages are allowed." });
  }

  try {
    const message = await createMessage(chatId, req.user.id, role, content);
    res.status(201).json({ message });
  } catch (error) {
    sendError(res, error, "Failed to create message.");
  }
});

router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  try {
    const messages = await findMessagesByChatId(chatId, req.user.id);
    res.json({ messages });
  } catch (error) {
    sendError(res, error, "Failed to fetch messages.");
  }
});

router.patch("/:chatId/read", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  try {
    const updatedCount = await markMessagesAsRead(chatId, req.user.id);
    res.json({
      success: true,
      updatedCount: updatedCount.count,
    });
  } catch (error) {
    sendError(res, error, "Failed to mark messages as read.");
  }
});

export default router;
