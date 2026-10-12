import { subscribeSSE } from "./sse.js";

// Client for the chat activity stream at GET /api/activity/:chatId/stream.
// The transport (auth header, frame parsing, backoff, resume by Last-Event-ID)
// lives in services/sse.js so the browser-frame stream shares it.
export function subscribeToActivityStream(chatId, { onEvent, onStatus } = {}) {
  return subscribeSSE(`/api/activity/${encodeURIComponent(chatId)}/stream`, {
    eventName: "activity",
    onData: (event, frame) => onEvent?.(event, frame?.id ?? event?.id),
    onStatus,
  });
}
