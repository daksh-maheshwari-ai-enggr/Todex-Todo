import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getBrowserStatus,
  relayFrameStream,
  browserScreenshot,
  takeBrowserControl,
  releaseBrowserControl,
  relayUserInput,
} from "../browser.js";
import { requirePendingApproval } from "../approvals.js";

// Endpoints for the live browser view.
//
// Reading is open to the owner; driving the browser (Phase C takeover) requires
// a PENDING approval, so the human can only take the wheel to answer a real
// pause. Everything here is scoped to a teammate the authenticated user owns.
// The sandbox preview URL and its token are resolved server-side on every
// request and are never sent to the client — the client only ever talks to this
// API, which is also what keeps the frame relay authenticated.

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

// POST /api/sandbox/:botId/desktop/control
// Hand the teammate's live browser to the human, or take it back.
//   { mode: "user", approvalId }  -> the answer to a pending pause
//   { mode: "agent" }             -> hand the wheel back to the teammate
router.post("/:botId/desktop/control", requireAuth, async (req, res) => {
  const { botId } = req.params;
  const { mode, approvalId } = req.body || {};

  if (!botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid bot ID." });
  }

  if (mode !== "user" && mode !== "agent") {
    return res.status(400).json({ error: "mode must be 'user' or 'agent'." });
  }

  try {
    if (mode === "user") {
      const approval = await requirePendingApproval({
        approvalId,
        userId: req.user.id,
        botId,
      });

      const control = await takeBrowserControl({ userId: req.user.id, botId });
      return res.json({ control: { ...control, approvalId: approval.id } });
    }

    const control = await releaseBrowserControl({ userId: req.user.id, botId });
    res.json({ control });
  } catch (error) {
    sendError(res, error, "Failed to change who controls the browser.");
  }
});

// POST /api/sandbox/:botId/desktop/input
// Relay the human's raw mouse/keyboard input into the live session. Only
// accepted while the human actually holds control; bounded and validated in the
// browser service before it reaches the sandbox.
router.post("/:botId/desktop/input", requireAuth, async (req, res) => {
  const { botId } = req.params;
  const { events } = req.body || {};

  if (!botId || typeof botId !== "string") {
    return res.status(400).json({ error: "Invalid bot ID." });
  }

  try {
    const input = await relayUserInput({ userId: req.user.id, botId, events });
    res.json({ input });
  } catch (error) {
    sendError(res, error, "Failed to send input to the browser.");
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
