const TONES = {
  default: "border-line bg-sidebar text-ink",
  error: "border-error-ink/20 bg-error text-error-ink",
  success: "border-success-ink/15 bg-success text-success-ink",
  terminal: "border-[#26243a] bg-[#1d1b2b] text-[#e9e7f5]",
};

// Renders raw text or JSON. Used for tool arguments, tool results, command
// output, job results and file contents, so all of them scroll the same way.
export default function CodeBlock({
  label,
  value,
  tone = "default",
  maxHeight = "15rem",
  className = "",
}) {
  const text =
    value == null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);

  return (
    <div className={className}>
      {label && <p className="mb-1 text-[11px] font-medium text-ink-muted">{label}</p>}
      <pre
        className={[
          "overflow-auto rounded-lg border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap scrollbar-slim",
          TONES[tone] ?? TONES.default,
        ].join(" ")}
        style={{ maxHeight }}
      >
        {text.length > 0 ? text : "—"}
      </pre>
    </div>
  );
}
