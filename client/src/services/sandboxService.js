import { apiRequest } from "./api.js";
import { subscribeSSE } from "./sse.js";

// Client for the teammate's live browser view.
//
// The app never talks to the sandbox directly: the Express API resolves the
// sandbox for the authenticated owner and relays the frames. No sandbox URL or
// preview token ever reaches the browser.

// GET /api/sandbox/:botId/desktop -> { desktop: { ready, url, title, controlMode, viewport, lastError } }
// Reports the real state; it does not create a sandbox or start a browser.
export async function getDesktopStatus(botId) {
  const payload = await apiRequest(`/sandbox/${encodeURIComponent(botId)}/desktop`);
  return (
    payload?.desktop ?? {
      ready: false,
      url: null,
      title: null,
      controlMode: "agent",
      viewport: null,
      lastError: null,
    }
  );
}

// GET /api/sandbox/:botId/desktop/shot -> a single current frame.
export async function getDesktopShot(botId) {
  const payload = await apiRequest(`/sandbox/${encodeURIComponent(botId)}/desktop/shot`);
  return payload?.shot ?? null;
}

// Live JPEG frames streamed from the teammate's own browser session.
export function subscribeToDesktopFrames(botId, { onFrame, onStatus } = {}) {
  return subscribeSSE(`/api/sandbox/${encodeURIComponent(botId)}/desktop/frames`, {
    onData: (frame) => {
      if (typeof frame?.jpeg === "string" && frame.jpeg.length > 0) {
        onFrame?.({
          jpeg: frame.jpeg,
          at: frame.at ?? null,
          // The page is rendered at this size, so a click on the displayed image
          // can be mapped onto real viewport coordinates.
          viewport: frame.viewport ?? null,
        });
      }
    },
    onStatus,
  });
}

// POST /api/sandbox/:botId/desktop/control
// Take the wheel: only accepted while the named approval is still PENDING, so
// taking over a teammate's browser is always the answer to a real pause.
export async function takeBrowserControl(botId, approvalId) {
  const payload = await apiRequest(`/sandbox/${encodeURIComponent(botId)}/desktop/control`, {
    method: "POST",
    body: { mode: "user", approvalId },
  });
  return payload?.control ?? null;
}

// POST /api/sandbox/:botId/desktop/control { mode: "agent" }
// Hand the browser back to the teammate.
export async function releaseBrowserControl(botId) {
  const payload = await apiRequest(`/sandbox/${encodeURIComponent(botId)}/desktop/control`, {
    method: "POST",
    body: { mode: "agent" },
  });
  return payload?.control ?? null;
}

// POST /api/sandbox/:botId/desktop/input
// One bounded batch of raw pointer/keyboard events from the live view.
export async function sendBrowserInput(botId, events) {
  const payload = await apiRequest(`/sandbox/${encodeURIComponent(botId)}/desktop/input`, {
    method: "POST",
    body: { events },
  });
  return payload?.input ?? null;
}
