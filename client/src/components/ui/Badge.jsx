import { toneClasses } from "../../utils/status.js";

export default function Badge({ tone = "neutral", className = "", children, dot = false }) {
  const classes = toneClasses(tone);

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        classes.badge,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot && <span className={`size-1.5 rounded-full ${classes.dot}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

// Convenience wrapper for the status helpers in utils/status.js, which already
// return a label and a tone.
export function StatusBadge({ status, pulse = false }) {
  const { label, tone } = status;

  return (
    <Badge tone={tone} className={pulse ? "animate-fade-in" : ""}>
      <span className={`size-1.5 rounded-full ${toneClasses(tone).dot}`} aria-hidden="true" />
      {label}
    </Badge>
  );
}
