import { avatarGradient, initials } from "../../utils/format.js";

// The server stores a short avatar seed for every teammate. Rendering a
// deterministic gradient from that seed keeps the UI self-contained: no external
// avatar service, no network request, and the same teammate always looks the same.
const SIZES = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
  xl: "size-14 text-base",
};

export default function Avatar({ seed, name, size = "md", className = "" }) {
  return (
    <span
      className={[
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-card",
        SIZES[size] ?? SIZES.md,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundImage: avatarGradient(seed) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
