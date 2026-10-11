import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CloudOff,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Server,
  WifiOff,
} from "lucide-react";

// Browser / Desktop pane.
//
// IMPORTANT: the backend does not expose a Daytona preview link, desktop stream
// or screenshot endpoint. Rather than render a fake website or a static image
// pretending to be live, this pane shows the real connection state and explains
// exactly which backend capability is missing. The chrome (address bar,
// navigation, refresh, connection status, expand) is fully designed and ready to
// be wired up the moment such an endpoint exists.
export default function BrowserPane({ teammate }) {
  const [expanded, setExpanded] = useState(false);

  const connected = false;
  const sandboxId = teammate?.sandboxId ?? null;

  const viewport = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[#fbfbfe] px-8 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-strong">
        {sandboxId ? (
          <Server className="size-6" aria-hidden="true" />
        ) : (
          <CloudOff className="size-6" aria-hidden="true" />
        )}
      </span>

      <h3 className="text-sm font-semibold text-ink">Sandbox preview not connected</h3>

      <p className="max-w-md text-xs leading-relaxed text-ink-muted">
        {sandboxId
          ? "This teammate has an isolated Daytona sandbox, but the API does not expose a preview link or desktop stream, so there is nothing live to display here."
          : "This teammate has not created a Daytona sandbox yet. One is provisioned the first time it runs a sandbox tool."}
      </p>

      <p className="max-w-md rounded-lg border border-line bg-card px-3 py-2 text-left text-[11px] leading-relaxed text-ink-muted">
        <span className="font-medium text-ink">Backend requirement:</span> a dedicated,
        ownership-checked route that returns a Daytona preview URL (or desktop/screenshot
        stream) for the teammate's own sandbox. No endpoint like that exists today —{" "}
        <span className="font-mono">server/sandbox.js</span> can stop, delete and inspect a
        sandbox but never exposes a preview link.
      </p>

      {sandboxId && (
        <p className="font-mono text-[10px] text-ink-muted">sandbox id: {sandboxId}</p>
      )}
    </div>
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-app p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-xl">
          <BrowserChrome
            connected={connected}
            expanded={expanded}
            onToggleExpand={() => setExpanded(false)}
          />
          {viewport}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BrowserChrome
        connected={connected}
        expanded={expanded}
        onToggleExpand={() => setExpanded(true)}
      />
      {viewport}
    </div>
  );
}

// Realistic browser chrome. Every control is disabled with an explanatory
// tooltip because there is no preview session to drive yet.
function BrowserChrome({ connected, expanded, onToggleExpand }) {
  const disabledTitle = "No preview session — the API does not expose a Daytona preview link yet.";

  return (
    <div className="border-b border-line bg-sidebar px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <ChromeButton label="Back" title={disabledTitle} disabled>
            <ArrowLeft className="size-4" aria-hidden="true" />
          </ChromeButton>
          <ChromeButton label="Forward" title={disabledTitle} disabled>
            <ArrowRight className="size-4" aria-hidden="true" />
          </ChromeButton>
          <ChromeButton label="Refresh" title={disabledTitle} disabled>
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </ChromeButton>
        </div>

        {/* Address bar */}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5">
          <Lock className="size-3 shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="truncate font-mono text-[11px] text-ink-muted">
            {connected ? "about:blank" : "no preview url"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[10px] font-medium text-ink-muted"
            title="Connection status to the teammate's sandbox preview"
          >
            <WifiOff className="size-3" aria-hidden="true" />
            {connected ? "Connected" : "Disconnected"}
          </span>

          <ChromeButton
            label={expanded ? "Exit fullscreen" : "Expand viewport"}
            title={expanded ? "Exit fullscreen" : "Expand viewport"}
            onClick={onToggleExpand}
          >
            {expanded ? (
              <Minimize2 className="size-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden="true" />
            )}
          </ChromeButton>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 px-1">
        <Monitor className="size-3 text-ink-muted" aria-hidden="true" />
        <span className="text-[10px] text-ink-muted">
          Browser / Desktop viewport
        </span>
      </div>
    </div>
  );
}

function ChromeButton({ label, title, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-card hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
