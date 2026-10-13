import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../services/api.js";
import { subscribeToActivityStream } from "../services/activityService.js";

// Maximum number of live events kept in memory for one chat.
const MAX_EVENTS = 300;

// Subscribes to the real execution events for a chat.
//
// Events come from the backend as they happen; this hook only stores, orders
// and de-duplicates them. It never fabricates progress. The persisted
// ToolExecution/Handoff records remain the durable history — this is the live
// view of the same work in flight.
export function useActivityStream(chatId, { enabled = true } = {}) {
  const [events, setEvents] = useState([]);
  const [connection, setConnection] = useState("idle");
  const [error, setError] = useState(null);

  // Track seen event ids so a replay after reconnect cannot duplicate a row.
  const seen = useRef(new Set());

  const append = useCallback((incoming) => {
    if (!incoming?.length) return;
    setEvents((previous) => {
      let changed = false;
      const next = previous.slice();

      for (const event of incoming) {
        if (!event?.id || seen.current.has(event.id)) continue;
        seen.current.add(event.id);
        next.push(event);
        changed = true;
      }

      if (!changed) return previous;
      // Sort by arrival time so a replayed batch slots in correctly.
      next.sort((a, b) => new Date(a.at ?? 0) - new Date(b.at ?? 0));
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
  }, []);

  const clear = useCallback(() => {
    seen.current = new Set();
    setEvents([]);
  }, []);

  // Reset when the chat changes, so one conversation never shows another's work.
  useEffect(() => {
    seen.current = new Set();
    setEvents([]);
    setError(null);
    setConnection("idle");
  }, [chatId]);

  useEffect(() => {
    if (!enabled || !chatId) return undefined;

    let cancelled = false;

    // Initial paint: whatever recent events the process still remembers.
    apiRequest(`/activity/${encodeURIComponent(chatId)}`)
      .then((payload) => {
        if (cancelled) return;
        append(payload?.events ?? []);
      })
      .catch(() => {
        // History is a convenience; the stream below is the real channel.
      });

    const stop = subscribeToActivityStream(chatId, {
      onEvent: (event) => append([event]),
      onStatus: (status) => {
        if (cancelled) return;
        setConnection(status.state);
        if (status.state === "error") setError(status.error ?? null);
        if (status.state === "open") setError(null);
      },
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [chatId, enabled, append]);

  // The task state is derived from the latest lifecycle event, not from a timer.
  // approval.resolved means the human answered and the run continues, so it
  // reads as running again; approval.pending parks the task as blocked (it
  // needs the user, not the model).
  const taskState = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const type = events[i]?.type;
      if (type === "approval.resolved") return "running";
      if (type === "approval.pending") return "blocked";
      if (type === "task.completed") return "completed";
      if (type === "task.blocked") return "blocked";
      if (type === "task.started" || type === "agent.thinking") return "running";
    }
    return "idle";
  }, [events]);

  return {
    events,
    connection,
    connected: connection === "open",
    error,
    taskState,
    clear,
  };
}
