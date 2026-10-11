import { Loader2 } from "lucide-react";

export default function Spinner({ label, className = "" }) {
  return (
    <div
      className={["flex items-center justify-center gap-2 text-xs text-ink-muted", className]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin-slow text-primary" aria-hidden="true" />
      {label && <span>{label}</span>}
      <span className="sr-only">Loading</span>
    </div>
  );
}

// Full-height variant for route-level loading states.
export function SpinnerBlock({ label = "Loading…" }) {
  return (
    <div className="grid h-64 place-items-center">
      <Spinner label={label} />
    </div>
  );
}
