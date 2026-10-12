import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../prisma.js";
import {
  subscribeToActivity,
  getActivitySince,
  getRecentActivity,
} from "../activity.js";

const router = Router();

// Ownership check shared by both endpoints. The chat id always comes from the
// URL, so it is verified against the authenticated user before any event is
// exposed — one user can never read another user's activity.
async function loadOwnedChat(chatId, userId) {
  if (!chatId || typeof chatId !== "string") return null;
  return prisma.chat.findFirst({ where: { id: chatId, userId } });
}

// GET /api/activity/:chatId
// Bounded history of recent in-process events, used by the initial paint and as
// a polling fallback when the stream cannot be established (for example through
// a proxy that buffers responses).
router.get("/:chatId", requireAuth, async (req, res) => {
  const { chatId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const chat = await loadOwnedChat(chatId, req.user.id);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found." });
    }

    res.json({ events: getRecentActivity(chatId, limit) });
  } catch (error) {
    console.error("Error loading activity:", error?.message);
    res.status(500).json({ error: "Failed to load activity." });
  }
});

// GET /api/activity/:chatId/stream
// Server-Sent Events stream of real execution events for one chat. The JWT is
// sent in the Authorization header (the client uses fetch, not EventSource, so
// the token never ends up in a URL or a server log).
router.get("/:chatId/stream", requireAuth, async (req, res) => {
  const { chatId } = req.params;

  let chat;
  try {
    chat = await loadOwnedChat(chatId, req.user.id);
  } catch (error) {
    console.error("Error loading activity stream context:", error?.message);
    return res.status(500).json({ error: "Failed to open the activity stream." });
  }

  if (!chat) {
    return res.status(404).json({ error: "Chat not found." });
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Stops reverse proxies from buffering the stream into uselessness.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Ask the client to retry after 3s if the connection drops.
  res.write("retry: 3000\n\n");

  const send = (event) => {
    res.write(`id: ${event.id}\n`);
    res.write("event: activity\n");
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay anything the client missed so a reconnect is not lossy. The browser
  // sends Last-Event-ID automatically when it reconnects the stream.
  const lastEventId = req.get("Last-Event-ID") || req.query.lastEventId;
  for (const event of getActivitySince(chatId, lastEventId)) {
    send(event);
  }

  const unsubscribe = subscribeToActivity(chatId, send);

  // Comment-only heartbeat keeps intermediaries from closing an idle stream.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // The cleanup below handles a closed socket.
    }
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

export default router;
