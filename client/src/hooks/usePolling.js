import { useEffect, useRef } from "react";

// Runs `callback` on a fixed interval while `active` is true.
//
// Used to track in-flight work (active background jobs, sandbox activity during
// a turn). Polling stops automatically once nothing is active, so idle screens
// make no requests.
export function usePolling(callback, { active, intervalMs = 5000 }) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!active || !intervalMs) return undefined;

    const timer = window.setInterval(() => {
      savedCallback.current?.();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
}
