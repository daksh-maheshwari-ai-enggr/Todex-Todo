import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createChat,
  createGroupChat,
  findChatsByUserId,
  findChatByIdAndUserId,
  updateChat,
  deleteChat,
  listParticipants,
  addParticipant,
  removeParticipant,
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

// Create a chat. A `botIds` array creates a group chat with teammate
// participants; a single `botId` creates (or omits) a direct chat as before.
router.post("/", requireAuth, async (req, res) => {
  const { botId, botIds, title } = req.body || {}

  try {
    const chat = Array.isArray(botIds)
      ? await createGroupChat(req.user.id, title, botIds)
      : await createChat(req.user.id, botId, title);
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

// List a chat's teammate participants.
router.get("/:chatId/participants", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const participants = await listParticipants(chatId, req.user.id);
    res.json({ participants });
  } catch (error) {
    sendError(res, error, "Failed to fetch participants.");
  }
});

// Add an owned bot as a participant of a group chat.
router.post("/:chatId/participants", requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const { botId } = req.body || {};

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chat ID" });
  }

  try {
    const participant = await addParticipant(chatId, req.user.id, botId);
    res.status(201).json({ participant });
  } catch (error) {
    sendError(res, error, "Failed to add participant.");
  }
});

// Remove a participant from a group chat.
router.delete("/:chatId/participants/:botId", requireAuth, async (req, res) => {
  const { chatId, botId } = req.params;

  if (!chatId || typeof chatId !== "string" || !botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid chat or bot ID" });
  }

  try {
    await removeParticipant(chatId, req.user.id, botId);
    res.status(204).send();
  } catch (error) {
    sendError(res, error, "Failed to remove participant.");
  }
});

export default router;
