import { Inbox } from "lucide-react";

// `note` is for the honest explanations of what the backend does not expose yet
// (for example: there is no preview endpoint). It is deliberately visually
// distinct from the description so it reads as a limitation, not decoration.
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  note,
  action,
  className = "",
}) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center rounded-card border border-dashed border-line bg-card/60 px-6 py-10 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary-strong">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-muted">{description}</p>
      )}

      {note && (
        <p className="mt-3 max-w-md rounded-lg border border-line bg-sidebar px-3 py-2 text-left text-[11px] leading-relaxed text-ink-muted">
          {note}
        </p>
      )}

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
