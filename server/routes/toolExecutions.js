import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { listToolExecutions } from "../toolExecutions.js";

const router = Router();

// Map a service error to an HTTP response without leaking internals.
function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

// GET /api/tool-executions/:chatId
// Read-only tool execution history for a chat owned by the authenticated user.
// Separate from the message-history endpoint; no write operations are exposed.
router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "chatId is required and must be a string." });
  }

  const { limit, cursor } = req.query || {};

  try {
    const { executions, nextCursor } = await listToolExecutions(chatId, req.user.id, {
      limit,
      cursor: typeof cursor === "string" ? cursor : undefined,
    });
    res.json({ executions, nextCursor });
  } catch (error) {
    sendError(res, error, "Failed to fetch tool executions.");
  }
});

export default router;
