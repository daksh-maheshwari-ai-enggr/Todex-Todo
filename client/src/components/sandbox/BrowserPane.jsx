import { useEffect, useState } from "react";
import {
  Camera,
  CloudOff,
  ExternalLink,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  Wifi,
  WifiOff,
} from "lucide-react";
import Button from "../ui/Button.jsx";
import {
  getDesktopStatus,
  getDesktopShot,
  subscribeToDesktopFrames,
} from "../../services/sandboxService.js";
import { truncate } from "../../utils/format.js";

// Browser / Desktop pane: a live view of the teammate's real browser session.
//
// Frames are relayed by the backend from the teammate's own sandbox, so what is
// shown here is the actual page the agent is driving — not a mock, a static
// image captured after the fact, or a transcript of activity text.
//
// The stream is only opened once a browser session actually exists, so merely
// visiting a chat never provisions anything.

const STATUS_POLL_MS = 5000;

export default function BrowserPane({ teammate }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(null);
  const [connection, setConnection] = useState("idle");
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState(null);
  const [activating, setActivating] = useState(false);
  const [still, setStill] = useState(null);

  const botId = teammate?.id ?? null;
  const sandboxId = teammate?.sandboxId ?? null;
  const ready = Boolean(status?.ready);

  // Report the teammate's real browser state. Cheap and side-effect free.
  useEffect(() => {
    if (!botId) return undefined;

    let cancelled = false;
    const check = async () => {
      try {
        const next = await getDesktopStatus(botId);
        if (!cancelled) setStatus(next);
      } catch (pollError) {
        if (!cancelled) setStatus({ ready: false, error: pollError?.message });
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [botId]);

  // Keep polling while there is no session, so a browser the teammate starts
  // mid-task is picked up without the user having to refresh.
  useEffect(() => {
    if (!botId || ready || activating) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const next = await getDesktopStatus(botId);
        setStatus(next);
      } catch {
        // Transient; the next tick retries.
      }
    }, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [botId, ready, activating]);

  // Attach the live frame stream once a session exists.
  useEffect(() => {
    if (!botId || (!ready && !activating)) return undefined;

    setError(null);
    const stop = subscribeToDesktopFrames(botId, {
      onFrame: (next) => setFrame(next),
      onStatus: (next) => {
        setConnection(next.state);
        if (next.state === "open") {
          setActivating(false);
          setError(null);
        }
        if (next.state === "error") {
          setActivating(false);
          setError(
            next.status === 404
              ? "This teammate's browser view is not available."
              : "Not authorised to view this teammate's browser.",
          );
        }
      },
    });

    return stop;
  }, [botId, ready, activating]);

  // Reset the view when switching teammates.
  useEffect(() => {
    setFrame(null);
    setStill(null);
    setError(null);
    setConnection("idle");
    setStatus(null);
    setActivating(false);
  }, [botId]);

  // Opt in explicitly: opening the frame stream makes the backend bootstrap a
  // browser session, which on a cold sandbox installs Chromium. That should
  // never happen just because someone opened the chat.
  function startNow() {
    if (!botId) return;
    setError(null);
    setActivating(true);
  }

  async function captureStill() {
    if (!botId) return;
    try {
      const shot = await getDesktopShot(botId);
      if (shot?.dataUrl) setStill(shot.dataUrl);
    } catch (error_) {
      setError(error_?.message ?? "Could not capture the browser view.");
    }
  }

  const frameSrc = frame ? `data:image/jpeg;base64,${frame.jpeg}` : still;
  const connected = connection === "open";

  const viewport = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-[#20242c]">
      {frameSrc ? (
        <img
          src={frameSrc}
          alt="Live view of the teammate's browser"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          {!sandboxId ? (
            <>
              <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-strong">
                <CloudOff className="size-6" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold text-ink">
                This teammate has no sandbox yet
              </h3>
              <p className="max-w-md text-xs leading-relaxed text-ink-muted">
                A sandbox is provisioned the first time the teammate runs a sandbox or browser
                tool. Ask it to do something that needs one, then come back here.
              </p>
            </>
          ) : activating || connection === "connecting" ? (
            <>
              <Loader2 className="size-6 animate-spin-slow text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-ink">
                {activating ? "Starting the browser session…" : "Connecting to the browser…"}
              </h3>
              <p className="max-w-md text-xs leading-relaxed text-ink-muted">
                The teammate's sandbox is preparing Chromium and the live view. On a cold
                sandbox this includes a one-time browser install, which can take a while.
              </p>
            </>
          ) : (
            <>
              <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-strong">
                <Monitor className="size-6" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold text-ink">No live browser session</h3>
              <p className="max-w-md text-xs leading-relaxed text-ink-muted">
                The teammate has a sandbox, but its browser is not running yet. It starts
                automatically the first time the teammate uses a browser tool.
              </p>
              <Button size="sm" variant="soft" icon={Play} onClick={startNow}>
                Start the browser now
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );

  const chrome = (
    <BrowserChrome
      connected={connected}
      connection={connection}
      url={status?.url ?? null}
      title={status?.title ?? null}
      expanded={expanded}
      onToggleExpand={() => setExpanded((value) => !value)}
      onCapture={captureStill}
      hasFrame={Boolean(frame)}
    />
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-app p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-xl">
          {chrome}
          {error && <ErrorStrip message={error} />}
          {viewport}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chrome}
      {error && <ErrorStrip message={error} />}
      {viewport}
    </div>
  );
}

function ErrorStrip({ message }) {
  return (
    <p className="border-b border-line bg-error px-3 py-2 text-[11px] text-error-ink">
      {message}
    </p>
  );
}

function BrowserChrome({
  connected,
  connection,
  url,
  title,
  expanded,
  onToggleExpand,
  onCapture,
  hasFrame,
}) {
  return (
    <div className="border-b border-line bg-sidebar px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5">
          <Lock className="size-3 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="truncate font-mono text-[11px] text-ink-muted">
            {url ?? (connected ? "about:blank" : "no page open")}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={[
              "inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10px] font-medium",
              connected ? "bg-success text-success-ink" : "bg-card text-ink-muted",
            ].join(" ")}
            title={
              connected
                ? "Receiving live frames from this teammate's browser"
                : `Stream state: ${connection}`
            }
          >
            {connected ? (
              <Wifi className="size-3" aria-hidden="true" />
            ) : (
              <WifiOff className="size-3" aria-hidden="true" />
            )}
            {connected ? "Live" : connection === "reconnecting" ? "Reconnecting" : "Offline"}
          </span>

          <button
            type="button"
            onClick={onCapture}
            className="grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card hover:text-ink"
            aria-label="Capture current frame"
            title="Capture the current frame"
          >
            <Camera className="size-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onToggleExpand}
            className="grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card hover:text-ink"
            aria-label={expanded ? "Exit fullscreen" : "Expand viewport"}
            title={expanded ? "Exit fullscreen" : "Expand viewport"}
          >
            {expanded ? (
              <Minimize2 className="size-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 px-1">
        <Monitor className="size-3 text-ink-muted" aria-hidden="true" />
        <span className="truncate text-[10px] text-ink-muted">
          {title ? truncate(title, 90) : hasFrame ? "Live viewport" : "Browser / Desktop viewport"}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary-strong hover:underline"
            title="Open the page in a new tab (loaded from the sandbox)"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            Page URL
          </a>
        )}
      </div>
    </div>
  );
}
