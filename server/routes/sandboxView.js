import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getBrowserStatus, relayFrameStream, browserScreenshot } from "../browser.js";

// Read-only endpoints for the live browser view.
//
// Everything here is scoped to a teammate the authenticated user owns. The
// sandbox preview URL and its token are resolved server-side on every request
// and are never sent to the client — the client only ever talks to this API.

const router = Router();

function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error?.message);
  return res.status(500).json({ error: fallbackMessage });
}

// GET /api/sandbox/:botId/desktop
// Current state of the teammate's browser session. Does not create a sandbox or
// start a browser; it reports what is actually there.
router.get("/:botId/desktop", requireAuth, async (req, res) => {
  const { botId } = req.params;
  if (!botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid bot ID." });
  }

  try {
    const status = await getBrowserStatus({ userId: req.user.id, botId });
    res.json({ desktop: status });
  } catch (error) {
    sendError(res, error, "Failed to read the browser state.");
  }
});

// GET /api/sandbox/:botId/desktop/frames
// Live frame stream relayed from the teammate's own browser session.
router.get("/:botId/desktop/frames", requireAuth, async (req, res) => {
  const { botId } = req.params;
  if (!botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid bot ID." });
  }

  try {
    await relayFrameStream({
      userId: req.user.id,
      botId,
      res,
      signal: req.signal ?? undefined,
    });
  } catch (error) {
    // Headers may already be sent; only send a JSON error when they are not.
    if (!res.headersSent) {
      return sendError(res, error, "Failed to open the browser stream.");
    }
    res.end();
  }
});

// GET /api/sandbox/:botId/desktop/shot
// A single current frame, used as a still fallback if the stream is unavailable.
router.get("/:botId/desktop/shot", requireAuth, async (req, res) => {
  const { botId } = req.params;
  if (!botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid bot ID." });
  }

  try {
    const shot = await browserScreenshot({ userId: req.user.id, botId, fullPage: false });
    res.json({ shot: { url: shot.url, title: shot.title, bytes: shot.bytes, dataUrl: shot.dataUrl } });
  } catch (error) {
    sendError(res, error, "Failed to capture the browser view.");
  }
});

export default router;
