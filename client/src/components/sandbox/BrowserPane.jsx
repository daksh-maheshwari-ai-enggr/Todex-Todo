import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CloudOff,
  ExternalLink,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointerClick,
  Play,
  Wifi,
  WifiOff,
} from "lucide-react";
import Button from "../ui/Button.jsx";
import {
  getDesktopStatus,
  getDesktopShot,
  releaseBrowserControl,
  sendBrowserInput,
  subscribeToDesktopFrames,
  takeBrowserControl,
} from "../../services/sandboxService.js";
import { truncate } from "../../utils/format.js";

// Browser / Desktop pane: a live view of the teammate's real browser session,
// and — when an approval is open — the wheel itself (ROADMAP.md Phase C).
//
// Frames are relayed by the backend from the teammate's own sandbox, so what is
// shown here is the actual page the agent is driving. Taking control drives that
// same session: the login the human performs is the one the agent continues with.
//
// The stream is only opened once a browser session actually exists, so merely
// visiting a chat never provisions anything.

const STATUS_POLL_MS = 5000;

// Keys forwarded as named keys. Everything else printable is forwarded as text.
const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "OS"]);

// Input events are batched briefly so a mouse drag does not become one HTTP
// request per pixel. Anything with ordering weight (clicks, keys, wheel) is
// flushed immediately.
const INPUT_FLUSH_MS = 80;
const MAX_BATCH = 50;

export default function BrowserPane({ teammate, takeoverApproval = null, onHandBack = null }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(null);
  const [connection, setConnection] = useState("idle");
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState(null);
  const [activating, setActivating] = useState(false);
  const [still, setStill] = useState(null);
  const [control, setControl] = useState("agent");
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState(null);
  const [handingBack, setHandingBack] = useState(false);
  const [focused, setFocused] = useState(false);

  const imageRef = useRef(null);
  const overlayRef = useRef(null);
  const queueRef = useRef([]);
  const flushTimerRef = useRef(null);
  const autoTookOverRef = useRef(null);

  const botId = teammate?.id ?? null;
  const sandboxId = teammate?.sandboxId ?? null;
  const ready = Boolean(status?.ready);
  const controlling = control === "user";
  const approvalId = takeoverApproval?.id ?? null;

  // Report the teammate's real browser state. Cheap and side-effect free.
  useEffect(() => {
    if (!botId) return undefined;

    let cancelled = false;
    const check = async () => {
      try {
        const next = await getDesktopStatus(botId);
        if (cancelled) return;
        setStatus(next);
        // The session is the source of truth for who is driving.
        if (next?.controlMode === "user" || next?.controlMode === "agent") {
          setControl(next.controlMode);
        }
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
        if (next?.controlMode) setControl(next.controlMode);
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
    setControl("agent");
    setControlError(null);
    setFocused(false);
  }, [botId]);

  // A takeover started from an approval card lands here: take the wheel once,
  // for that specific approval.
  useEffect(() => {
    if (!approvalId || !botId) return;
    if (autoTookOverRef.current === approvalId) return;
    autoTookOverRef.current = approvalId;
    takeControl();
    // takeControl is intentionally not a dependency: it is re-created every
    // render and this must run exactly once per approval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId, botId]);

  // Drop any queued input and stop the flush timer on unmount.
  useEffect(
    () => () => {
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
      queueRef.current = [];
    },
    [],
  );

  async function flush() {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const batch = queueRef.current.splice(0, MAX_BATCH);
    if (batch.length === 0 || !botId) return;

    try {
      await sendBrowserInput(botId, batch);
      setControlError(null);
    } catch (sendError) {
      setControlError(sendError?.message ?? "Could not send input to the browser.");
    }
  }

  function enqueue(events, { immediate = false } = {}) {
    if (!controlling) return;
    queueRef.current.push(...events);

    if (immediate) {
      flush();
      return;
    }

    if (flushTimerRef.current) return;
    flushTimerRef.current = window.setTimeout(() => {
      flush();
    }, INPUT_FLUSH_MS);
  }

  async function takeControl() {
    if (!botId || controlBusy) return;
    setControlBusy(true);
    setControlError(null);
    try {
      const next = await takeBrowserControl(botId, approvalId);
      setControl(next?.controlMode === "user" ? "user" : "agent");
      setStatus((previous) => ({ ...(previous ?? {}), controlMode: "user" }));
      // The overlay must be focusable for keystrokes to flow.
      window.setTimeout(() => overlayRef.current?.focus?.(), 0);
    } catch (takeError) {
      setControlError(takeError?.message ?? "Could not take control of the browser.");
    } finally {
      setControlBusy(false);
    }
  }

  async function handBack() {
    if (!botId) return;

    // Flush anything still queued so the last keystrokes are not lost.
    await flush();

    setHandingBack(true);
    setControlError(null);
    try {
      await releaseBrowserControl(botId);
      setControl("agent");
      setFocused(false);
      queueRef.current = [];
      setStatus((previous) => ({ ...(previous ?? {}), controlMode: "agent" }));
      await onHandBack?.(takeoverApproval);
    } catch (releaseError) {
      setControlError(releaseError?.message ?? "Could not hand the browser back.");
    } finally {
      setHandingBack(false);
    }
  }

  // The page the click has to land on: the image is drawn object-contain, so
  // the letterboxed margins are excluded and the rest is mapped onto the real
  // viewport size the sandbox session reported.
  function mapPoint(event) {
    const image = imageRef.current;
    if (!image) return null;

    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const viewport =
      frame?.viewport ?? status?.viewport ?? { width: image.naturalWidth, height: image.naturalHeight };
    if (!viewport?.width || !viewport?.height) return null;

    const imageAspect = (image.naturalWidth || viewport.width) / (image.naturalHeight || viewport.height);
    const boxAspect = rect.width / rect.height;

    let drawWidth = rect.width;
    let drawHeight = rect.height;
    if (imageAspect > boxAspect) drawHeight = rect.width / imageAspect;
    else drawWidth = rect.height * imageAspect;

    const offsetX = (rect.width - drawWidth) / 2;
    const offsetY = (rect.height - drawHeight) / 2;

    const x = ((event.clientX - rect.left - offsetX) / drawWidth) * viewport.width;
    const y = ((event.clientY - rect.top - offsetY) / drawHeight) * viewport.height;

    if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null;

    return { x: Math.round(x), y: Math.round(y) };
  }

  function onPointerDown(event) {
    if (!controlling) return;
    overlayRef.current?.focus?.();
    const point = mapPoint(event);
    if (!point) return;
    event.preventDefault();
    enqueue([{ type: "mouse_down", ...point, button: event.button === 2 ? "right" : "left" }], {
      immediate: true,
    });
  }

  function onPointerMove(event) {
    if (!controlling) return;
    const point = mapPoint(event);
    if (!point) return;
    enqueue([{ type: "mouse_move", ...point }]);
  }

  function onPointerUp(event) {
    if (!controlling) return;
    const point = mapPoint(event);
    if (!point) return;
    enqueue([{ type: "mouse_up", ...point, button: event.button === 2 ? "right" : "left" }], {
      immediate: true,
    });
  }

  // Note: React registers wheel handlers passively, so preventDefault() here
  // would be ignored. The overlay relies on `touch-none` and on the pane not
  // being a scroll container instead: the delta is forwarded to the page, which
  // is the behaviour that matters.
  function onWheel(event) {
    if (!controlling) return;
    const point = mapPoint(event);
    enqueue(
      [
        {
          type: "wheel",
          ...(point ?? {}),
          deltaX: Math.round(event.deltaX),
          deltaY: Math.round(event.deltaY),
        },
      ],
      { immediate: true },
    );
  }

  // Forward one keystroke. Modifiers become a chord ("Control+A") because the
  // relay presses keys rather than holding them; holding a bare modifier
  // (shift-drag selection) is therefore not supported.
  function onKeyDown(event) {
    if (!controlling) return;

    const key = event.key;
    if (!key || MODIFIER_KEYS.has(key)) return;

    const modifiers = [];
    if (event.ctrlKey) modifiers.push("Control");
    if (event.altKey) modifiers.push("Alt");
    if (event.metaKey) modifiers.push("Meta");

    let forward = null;
    if (key.length === 1) {
      // A printable character already encodes Shift in its own value ("A", "!").
      forward = [...modifiers, key].join("+");
    } else if (NAMED_KEYS.has(key)) {
      if (event.shiftKey) modifiers.push("Shift");
      forward = [...modifiers, key].join("+");
    }

    if (!forward) return;

    event.preventDefault();
    enqueue([{ type: "press", key: forward }], { immediate: true });
  }

  // Pasting an OTP or a URL is the common case: send it as text, not keystrokes.
  function onPaste(event) {
    if (!controlling) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text) return;
    event.preventDefault();
    enqueue([{ type: "text", text }], { immediate: true });
  }

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
        <>
          <img
            ref={imageRef}
            src={frameSrc}
            alt="Live view of the teammate's browser"
            className="h-full w-full object-contain"
            draggable={false}
          />

          {/* The input surface sits above the image and only exists while the
              human holds control, so there is no way to click "into" a page the
              agent is driving. */}
          {controlling && (
            <div
              ref={overlayRef}
              role="application"
              aria-label="Interactive browser view. You have control."
              tabIndex={0}
              className="absolute inset-0 touch-none cursor-crosshair outline-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onContextMenu={(event) => event.preventDefault()}
            />
          )}
        </>
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
      controlling={controlling}
      canTakeOver={Boolean(approvalId) && !controlling}
      controlBusy={controlBusy}
      handingBack={handingBack}
      onTakeControl={takeControl}
      onHandBack={handBack}
    />
  );

  const takeoverStrip = controlling ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-running-ink/20 bg-running px-3 py-2 text-[11px] text-running-ink">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <MousePointerClick className="size-3.5 shrink-0" aria-hidden="true" />
        You have control
      </span>
      <span>
        Click the viewport, then type. {focused ? "" : "Keystrokes reach the page only while it is focused. "}
        The teammate paused and will continue from whatever you leave behind.
      </span>
    </div>
  ) : null;

  if (expanded) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-app p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-xl">
          {chrome}
          {takeoverStrip}
          {error && <ErrorStrip message={error} />}
          {controlError && <ErrorStrip message={controlError} />}
          {viewport}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chrome}
      {takeoverStrip}
      {error && <ErrorStrip message={error} />}
      {controlError && <ErrorStrip message={controlError} />}
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
  controlling,
  canTakeOver,
  controlBusy,
  handingBack,
  onTakeControl,
  onHandBack,
}) {
  return (
    <div className="border-b border-line bg-sidebar px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
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

          {controlling ? (
            <Button
              size="sm"
              variant="soft"
              icon={MousePointerClick}
              loading={handingBack}
              disabled={handingBack}
              onClick={onHandBack}
            >
              Hand back
            </Button>
          ) : (
            canTakeOver && (
              <Button
                size="sm"
                variant="soft"
                icon={MousePointerClick}
                loading={controlBusy}
                disabled={controlBusy}
                onClick={onTakeControl}
              >
                Take control
              </Button>
            )
          )}

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
          {title
            ? truncate(title, 90)
            : hasFrame
              ? "Live viewport"
              : "Browser / Desktop viewport"}
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
