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

router.post("/", requireAuth, async (req, res) => {
  const { botId, title } = req.body || {}

  try {
    const chat = await createChat(req.user.id, botId, title);
    res.status(201).json({ chat });
  } catch (error) {
    console.error("Error creating chat:", error.message);
    res.status(400).json({ error: error.message });
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
    if (!chat) {
      return res.status(404).json({ error: "Chat not found or does not belong to the authenticated user" });
    }
    res.json({ chat });
  } catch (error) {
    console.error("Error updating chat:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.delete("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const chat = await deleteChat(chatId, req.user.id);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found or does not belong to the authenticated user" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

export default router;