const FIELD_BASE =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 transition-colors focus:border-primary focus:outline-none disabled:opacity-60";

export default function Input({ label, hint, error, id, className = "", ...rest }) {
  const fieldId = id || rest.name;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-ink">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        className={[FIELD_BASE, error ? "border-error-ink/40" : ""].filter(Boolean).join(" ")}
        {...rest}
      />
      {hint && !error && <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-error-ink">{error}</p>}
    </div>
  );
}

export function Textarea({ label, hint, error, id, rows = 5, className = "", ...rest }) {
  const fieldId = id || rest.name;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-ink">
          {label}
        </label>
      )}
      <textarea
        id={fieldId}
        rows={rows}
        className={[FIELD_BASE, "resize-y", error ? "border-error-ink/40" : ""]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      />
      {hint && !error && <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-error-ink">{error}</p>}
    </div>
  );
}
