import { apiRequest } from "./api.js";
import { subscribeSSE } from "./sse.js";

// Client for the teammate's live browser view.
//
// The app never talks to the sandbox directly: the Express API resolves the
// sandbox for the authenticated owner and relays the frames. No sandbox URL or
// preview token ever reaches the browser.

// GET /api/sandbox/:botId/desktop -> { desktop: { ready, url, title, lastError } }
// Reports the real state; it does not create a sandbox or start a browser.
export async function getDesktopStatus(botId) {
  const payload = await apiRequest(`/sandbox/${encodeURIComponent(botId)}/desktop`);
  return payload?.desktop ?? { ready: false, url: null, title: null, lastError: null };
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
        onFrame?.({ jpeg: frame.jpeg, at: frame.at ?? null });
      }
    },
    onStatus,
  });
}
