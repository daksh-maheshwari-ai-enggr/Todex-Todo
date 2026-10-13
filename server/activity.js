// Activity bus.
//
// The chat UI needs to show what a teammate is doing *while* a turn runs, not
// only after it finishes. This module is the single place that turns real
// execution milestones into events and fans them out to connected clients.
//
// Design notes:
//   * Events are emitted only from code that actually performed the work (the
//     agent graph nodes, the chat turn, tool implementations). Nothing here
//     simulates progress on a timer or from a hardcoded script.
//   * Delivery is in-process only. The app is a modular monolith serving both
//     the API and the SSE stream from one Node process, so an EventEmitter-style
//     registry is sufficient and avoids a second piece of infrastructure.
//   * A bounded per-chat replay buffer lets a reconnecting client catch up on
//     the events it missed instead of losing them.
//   * Persistence is deliberately absent: the durable record of what ran is
//     already stored in ToolExecution/Handoff, and `getRecentActivity` is a
//     convenience for the initial paint, not a second source of truth.

// How many recent events are kept per chat for reconnect replay.
const REPLAY_LIMIT = 200;

/** @type {Map<string, Set<Function>>} chatId -> listeners */
const listenersByChat = new Map();
/** @type {Map<string, Array<object>>} chatId -> bounded event ring */
const recentByChat = new Map();

let sequence = 0;

// Event types. Kept as a flat enum so the client can switch on them without
// string matching on human text.
export const ACTIVITY_TYPES = {
  taskStarted: "task.started",
  agentThinking: "agent.thinking",
  toolStarted: "tool.started",
  toolFinished: "tool.finished",
  toolFailed: "tool.failed",
  handoffStarted: "handoff.started",
  handoffFinished: "handoff.finished",
  taskCompleted: "task.completed",
  taskBlocked: "task.blocked",
  approvalPending: "approval.pending",
  approvalResolved: "approval.resolved",
};

function nextEventId() {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function short(value, max = 400) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string") return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Publish one event to every listener for the chat and remember it for replay.
// Emission never throws: a failed tool call must still reach the model even if
// the activity stream is broken.
export function emitActivity(chatId, event) {
  try {
    if (!chatId || typeof chatId !== "string") return null;
    if (!event || typeof event !== "object" || !event.type) return null;

    const record = {
      id: nextEventId(),
      chatId,
      at: new Date().toISOString(),
      botId: event.botId ?? null,
      type: String(event.type),
      status: event.status ?? null,
      title: event.title ? String(event.title) : null,
      detail: short(event.detail),
      tool: event.tool ?? null,
      data: event.data ?? null,
    };

    const ring = recentByChat.get(chatId) ?? [];
    ring.push(record);
    if (ring.length > REPLAY_LIMIT) ring.splice(0, ring.length - REPLAY_LIMIT);
    recentByChat.set(chatId, ring);

    const listeners = listenersByChat.get(chatId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(record);
        } catch (error) {
          console.warn("[activity] listener failed:", error?.message);
        }
      }
    }

    return record;
  } catch (error) {
    console.warn("[activity] emit failed:", error?.message);
    return null;
  }
}

// Subscribe to a chat's live events. Returns an unsubscribe function.
export function subscribeToActivity(chatId, listener) {
  if (!chatId || typeof chatId !== "string" || typeof listener !== "function") {
    return () => {};
  }

  const listeners = listenersByChat.get(chatId) ?? new Set();
  listeners.add(listener);
  listenersByChat.set(chatId, listeners);

  return () => {
    const current = listenersByChat.get(chatId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByChat.delete(chatId);
  };
}

// Events emitted after `lastEventId`, used to resume an interrupted stream.
export function getActivitySince(chatId, lastEventId) {
  const ring = recentByChat.get(chatId) ?? [];
  if (!lastEventId) return ring.slice();
  const index = ring.findIndex((event) => event.id === lastEventId);
  return index === -1 ? ring.slice() : ring.slice(index + 1);
}

export function getRecentActivity(chatId, limit = 50) {
  const ring = recentByChat.get(chatId) ?? [];
  return ring.slice(-limit);
}

// Terse helpers for the call sites. Every one of these corresponds to work that
// has already happened at the point it is called.

export function activityTaskStarted({ chatId, botId, botName, message }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.taskStarted,
    botId,
    status: "running",
    title: botName ? `${botName} started the task` : "Task started",
    detail: short(message, 200),
  });
}

export function activityAgentThinking({ chatId, botId, step }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.agentThinking,
    botId,
    status: "running",
    title: "Deciding what to do next",
    detail: step ? `Reasoning step ${step}` : null,
  });
}

export function activityToolStarted({ chatId, botId, toolName, args, label }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.toolStarted,
    botId,
    status: "running",
    title: label ? `${label}` : `${toolName} started`,
    tool: toolName,
    detail: short(args, 300),
  });
}

export function activityToolFinished({ chatId, botId, toolName, result, ok }) {
  return emitActivity(chatId, {
    type: ok === false ? ACTIVITY_TYPES.toolFailed : ACTIVITY_TYPES.toolFinished,
    botId,
    status: ok === false ? "failed" : "succeeded",
    title: ok === false ? `${toolName} failed` : `${toolName} returned a result`,
    tool: toolName,
    detail: short(result, 500),
  });
}

export function activityHandoff({ chatId, botId, to, task, phase }) {
  return emitActivity(chatId, {
    type: phase === "start" ? ACTIVITY_TYPES.handoffStarted : ACTIVITY_TYPES.handoffFinished,
    botId,
    status: phase === "start" ? "running" : "succeeded",
    title: phase === "start" ? `Handing off to ${to}` : `${to} finished the delegated task`,
    detail: short(task, 300),
  });
}

export function activityTaskCompleted({ chatId, botId, summary }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.taskCompleted,
    botId,
    status: "completed",
    title: "Task completed",
    detail: short(summary, 400),
  });
}

export function activityTaskBlocked({ chatId, botId, reason }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.taskBlocked,
    botId,
    status: "blocked",
    title: "Task blocked",
    detail: short(reason, 400),
  });
}

// Emitted when a run actually paused on a human approval (the approval row
// exists at this point) — not when a question was merely asked of the model.
export function activityApprovalPending({ chatId, botId, approval }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.approvalPending,
    botId,
    status: "waiting",
    title:
      approval?.kind === "ACTION" ? "Waiting for your approval" : "Waiting for your answer",
    detail: short(approval?.question, 300),
    data: approval ? { approvalId: approval.id, kind: approval.kind } : null,
  });
}

// Emitted after the owner responded; the run resumes right after this point.
export function activityApprovalResolved({ chatId, botId, approval }) {
  return emitActivity(chatId, {
    type: ACTIVITY_TYPES.approvalResolved,
    botId,
    status: approval?.status === "REJECTED" ? "rejected" : "approved",
    title:
      approval?.status === "REJECTED" ? "Action rejected" : "Approval given — resuming",
    detail: short(approval?.response, 300),
    data: approval ? { approvalId: approval.id, kind: approval.kind } : null,
  });
}
