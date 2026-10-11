import { Briefcase, MessageSquare, Pencil, Server, Trash2 } from "lucide-react";
import Avatar from "../ui/Avatar.jsx";
import Badge from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import { formatRelativeTime } from "../../utils/format.js";

export default function TeammateCard({
  teammate,
  onChat,
  onEdit,
  onDelete,
  busy = false,
  className = "",
}) {
  return (
    <div
      className={[
        "flex flex-col rounded-card border border-line bg-card p-4 shadow-[0_1px_2px_rgba(38,36,58,0.04)] transition-shadow hover:shadow-[0_2px_10px_rgba(38,36,58,0.06)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start gap-3">
        <Avatar seed={teammate.avatar ?? teammate.id} name={teammate.name} size="lg" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink">{teammate.name}</h3>
            {teammate.sandboxId && (
              <Badge tone="neutral" className="font-mono">
                <Server className="size-2.5" aria-hidden="true" />
                sandbox
              </Badge>
            )}
          </div>

          <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary-strong">
            <Briefcase className="size-3" aria-hidden="true" />
            {teammate.job}
          </p>
        </div>
      </div>

      <p className="mt-3 line-clamp-3 min-h-[2.5rem] text-xs leading-relaxed text-ink-muted">
        {teammate.instructions?.trim()
          ? teammate.instructions
          : "No custom instructions. This teammate replies using its job description only."}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line-soft pt-3">
        <span className="text-[10px] text-ink-muted">
          created {formatRelativeTime(teammate.createdAt)}
        </span>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="soft" icon={MessageSquare} onClick={() => onChat?.(teammate)} disabled={busy}>
            Chat
          </Button>
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit?.(teammate)} disabled={busy}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={() => onDelete?.(teammate)}
            disabled={busy}
            className="text-error-ink hover:bg-error"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
