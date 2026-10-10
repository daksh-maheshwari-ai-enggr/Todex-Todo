import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listHandoffs } from "../handoffs.js";

const router = Router();

// Map a service error to an HTTP response without leaking internals.
function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

// GET /api/handoffs/:chatId
// Read-only teammate handoff history for a chat the user owns. Handoffs are
// only ever created by trusted server-side agent execution, never by clients.
router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  const { limit, cursor } = req.query || {};

  try {
    const { handoffs, nextCursor } = await listHandoffs(chatId, req.user.id, {
      limit,
      cursor: typeof cursor === "string" ? cursor : undefined,
    });
    res.json({ handoffs, nextCursor });
  } catch (error) {
    sendError(res, error, "Failed to fetch handoffs.");
  }
});

export default router;
