import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createChat,
  findChatsByUserId,
  findChatByIdAndUserId,
  updateChat,
  deleteChat,
} from "../chats.js";

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
  const { botId, title } = req.body || {}

  try {
    const chat = await createChat(req.user.id, botId, title);
    res.status(201).json({ chat });
  } catch (error) {
    sendError(res, error, "Failed to create chat.");
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const chats = await findChatsByUserId(req.user.id);
    res.json({ chats });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const chat = await findChatByIdAndUserId(chatId, req.user.id);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found or does not belong to the authenticated user" });
    }
    res.json({ chat });
  } catch (error) {
    console.error("Error fetching chat:", error);
    res.status(500).json({ error: "Failed to fetch chat" });
  }
});

router.patch("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const { title } = req.body || {}

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const chat = await updateChat(chatId, req.user.id, { title });
    res.json({ chat });
  } catch (error) {
    sendError(res, error, "Failed to update chat.");
  }
});

router.delete("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    await deleteChat(chatId, req.user.id);
    res.status(204).send();
  } catch (error) {
    sendError(res, error, "Failed to delete chat.");
  }
});

export default router;
