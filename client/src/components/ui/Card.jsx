// Soft white surface with a hairline border — the base building block for every
// dashboard and workspace panel.
export default function Card({ className = "", children, padded = true, ...rest }) {
  return (
    <div
      className={[
        "rounded-card border border-line bg-card shadow-[0_1px_2px_rgba(38,36,58,0.04)]",
        padded ? "p-5" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, icon: Icon = null, className = "" }) {
  return (
    <div className={["flex items-start justify-between gap-4", className].filter(Boolean).join(" ")}>
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-strong">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
