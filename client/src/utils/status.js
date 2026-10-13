// Shared status vocabulary for jobs, tool executions and handoffs. Keeping the
// mapping in one place means a status badge always looks the same everywhere.

// Tone names map to the palette tokens in index.css: success (green), running
// (amber), error (red), idle (neutral).
const TONES = {
  success: {
    badge: "bg-success text-success-ink",
    dot: "bg-success-ink",
  },
  running: {
    badge: "bg-running text-running-ink",
    dot: "bg-running-ink",
  },
  error: {
    badge: "bg-error text-error-ink",
    dot: "bg-error-ink",
  },
  idle: {
    badge: "bg-primary-soft text-primary-strong",
    dot: "bg-primary-strong",
  },
  neutral: {
    badge: "bg-line-soft text-ink-muted",
    dot: "bg-ink-muted",
  },
};

export function toneClasses(tone) {
  return TONES[tone] ?? TONES.neutral;
}

// Application job lifecycle:
// QUEUED | RUNNING | WAITING_FOR_USER | SUCCEEDED | FAILED | CANCELLED
const JOB_STATUS = {
  QUEUED: { label: "Queued", tone: "idle" },
  RUNNING: { label: "Running", tone: "running" },
  WAITING_FOR_USER: { label: "Waiting for you", tone: "running" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "error" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

// Scheduled task lifecycle: ACTIVE | PAUSED | COMPLETED.
const SCHEDULED_TASK_STATUS = {
  ACTIVE: { label: "Scheduled", tone: "idle" },
  PAUSED: { label: "Paused", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "success" },
};

// Tool execution / handoff lifecycle: PENDING | RUNNING | SUCCEEDED | FAILED
const EXECUTION_STATUS = {
  PENDING: { label: "Pending", tone: "neutral" },
  RUNNING: { label: "Running", tone: "running" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "error" },
};

function describe(map, status, fallback) {
  const key = typeof status === "string" ? status.toUpperCase() : "";
  return map[key] ?? { label: status ? String(status) : fallback, tone: "neutral" };
}

export function jobStatus(status) {
  return describe(JOB_STATUS, status, "Unknown");
}

export function scheduledTaskStatus(status) {
  return describe(SCHEDULED_TASK_STATUS, status, "Unknown");
}

export function executionStatus(status) {
  return describe(EXECUTION_STATUS, status, "Unknown");
}

// Active job states are the ones worth polling and worth offering a cancel for.
// WAITING_FOR_USER counts as active: the run is parked on an approval and will
// continue (or be cancelled) — it is neither finished nor silently stuck.
export function isJobActive(status) {
  return status === "QUEUED" || status === "RUNNING" || status === "WAITING_FOR_USER";
}
