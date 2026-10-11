// Controlled tab strip. Each tab may carry an icon and a small count badge so
// panels can show how much real activity they contain.
export default function Tabs({ tabs, activeId, onChange, className = "" }) {
  return (
    <div
      role="tablist"
      className={["flex items-center gap-1 overflow-x-auto scrollbar-slim", className]
        .filter(Boolean)
        .join(" ")}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={[
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary-soft text-primary-strong"
                : "text-ink-muted hover:bg-sidebar hover:text-ink",
            ].join(" ")}
          >
            {Icon && <Icon className="size-3.5" aria-hidden="true" />}
            {tab.label}
            {tab.count != null && (
              <span
                className={[
                  "ml-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold",
                  active ? "bg-card text-primary-strong" : "bg-line-soft text-ink-muted",
                ].join(" ")}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
