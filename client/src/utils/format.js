// Presentation-only formatting helpers. Nothing here fabricates data.

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";

  const units = [
    ["minute", 60],
    ["hour", 60],
    ["day", 24],
    ["week", 7],
    ["month", 4.35],
    ["year", 12],
  ];

  let amount = seconds / 60;
  let unit = "minute";
  for (let i = 0; i < units.length; i += 1) {
    const [name, divisor] = units[i];
    unit = name;
    if (i === units.length - 1 || amount < units[i + 1]?.[1]) break;
    amount /= units[i + 1][1];
  }

  const rounded = Math.max(1, Math.round(amount));
  return `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`;
}

export function formatDuration(durationMs) {
  if (durationMs == null || Number.isNaN(Number(durationMs))) return "—";
  const ms = Number(durationMs);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;

  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return "—";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncate(text, maxLength = 120) {
  const value = typeof text === "string" ? text : "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

// Tool arguments and results are stored as strings; results are usually
// JSON-stringified objects. Parse leniently and fall back to the raw text.
export function parseMaybeJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[[{]/.test(trimmed)) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// Deterministic pastel gradient per teammate, derived from the avatar seed the
// server generates. Avoids any external avatar service.
export function avatarGradient(seed) {
  const source = typeof seed === "string" && seed ? seed : "todex";
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 360;
  }
  const hue = hash;
  return `linear-gradient(135deg, hsl(${hue} 68% 74%), hsl(${(hue + 48) % 360} 72% 66%))`;
}

export function initials(name) {
  const source = typeof name === "string" ? name.trim() : "";
  if (!source) return "AI";

  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
