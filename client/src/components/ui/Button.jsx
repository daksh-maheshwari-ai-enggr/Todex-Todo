import { Loader2 } from "lucide-react";

// `buttonClass` is exported so router <Link>s can look like buttons without
// duplicating the styling.
const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-strong border border-transparent",
  secondary: "bg-card text-ink border border-line hover:bg-primary-soft",
  soft: "bg-primary-soft text-primary-strong border border-transparent hover:bg-[#e5e0ff]",
  ghost: "bg-transparent text-ink-muted border border-transparent hover:bg-sidebar hover:text-ink",
  danger: "bg-error text-error-ink border border-transparent hover:bg-[#f8dcdf]",
};

const SIZES = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export function buttonClass({ variant = "primary", size = "md", className = "" } = {}) {
  return [
    "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant] ?? VARIANTS.primary,
    SIZES[size] ?? SIZES.md,
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon: Icon = null,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, className })}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin-slow" aria-hidden="true" />
      ) : (
        Icon && <Icon className="size-4" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
