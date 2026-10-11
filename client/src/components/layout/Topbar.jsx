export default function Topbar({ title, description, actions, children, className = "" }) {
  return (
    <header
      className={[
        "flex flex-wrap items-center justify-between gap-3 border-b border-line bg-app/85 px-6 py-4 backdrop-blur",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>

      {(actions || children) && (
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {children}
        </div>
      )}
    </header>
  );
}
