import { getStoredToken } from "./api.js";

// Reusable Server-Sent Events client built on fetch.
//
// EventSource cannot send an Authorization header, and putting the JWT in a
// query string would leak it into URLs, proxy logs and browser history. This
// subscriber therefore reads the stream with fetch() and parses SSE frames by
// hand, which also gives explicit control over reconnection and over the
// Last-Event-ID used to resume a dropped stream without losing events.

const MAX_BACKOFF_MS = 15000;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse one raw SSE block ("id: 1\nevent: activity\ndata: {...}") into its fields.
export function parseFrame(raw) {
  let id = null;
  let event = "message";
  let retry = null;
  const dataLines = [];

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");

    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "retry") retry = Number(value);
    else if (field === "data") dataLines.push(value);
  }

  return { id, event, retry, data: dataLines.join("\n") };
}

async function readStream(body, { onFrame }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (raw.trim()) onFrame?.(parseFrame(raw));
      boundary = buffer.indexOf("\n\n");
    }
  }
}

// Opens an SSE endpoint and keeps it open. Returns a stop() function.
//
// onStatus receives connection transitions:
//   "connecting" | "open" | "reconnecting" | "closed" | "error"
export function subscribeSSE(url, { onData, onStatus, eventName = null } = {}) {
  let stopped = false;
  let controller = null;
  let lastEventId = null;
  let attempt = 0;
  let serverRetryMs = 3000;

  async function run() {
    while (!stopped) {
      controller = new AbortController();
      const headers = { Accept: "text/event-stream" };
      const token = getStoredToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      try {
        onStatus?.({ state: attempt === 0 ? "connecting" : "reconnecting", attempt });

        const response = await fetch(url, { headers, signal: controller.signal });

        // Authentication, authorisation and existence failures never succeed on
        // retry, so surface them and stop instead of looping.
        if ([401, 403, 404].includes(response.status)) {
          onStatus?.({ state: "error", status: response.status });
          return;
        }

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed with status ${response.status}.`);
        }

        attempt = 0;
        onStatus?.({ state: "open" });

        await readStream(response.body, {
          onFrame: (frame) => {
            if (frame.id) lastEventId = frame.id;

            if (frame.retry && Number.isFinite(frame.retry)) {
              serverRetryMs = Math.min(Math.max(frame.retry, 500), MAX_BACKOFF_MS);
            }

            if (eventName && frame.event !== eventName) return;
            if (!frame.data) return;

            try {
              onData?.(JSON.parse(frame.data), frame);
            } catch {
              // A malformed frame is skipped rather than killing the stream.
            }
          },
        });

        if (stopped) return;
        onStatus?.({ state: "reconnecting", attempt });
      } catch (error) {
        if (stopped || error?.name === "AbortError") return;
        onStatus?.({ state: "reconnecting", attempt, error });
      }

      attempt += 1;
      const delay = Math.max(
        serverRetryMs,
        Math.min(1000 * 2 ** Math.min(attempt - 1, 4), MAX_BACKOFF_MS),
      );
      await sleep(delay);
    }
  }

  run();

  return () => {
    stopped = true;
    onStatus?.({ state: "closed" });
    controller?.abort();
  };
}
