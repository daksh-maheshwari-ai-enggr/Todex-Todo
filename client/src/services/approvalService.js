import { apiRequest } from "./api.js";

// Human-in-the-loop approvals (ROADMAP.md Phase A).
// The transport (JWT, error normalization) lives in services/api.js.

// GET /api/approvals?chatId=... -> { approvals } (PENDING only)
export async function listApprovals(chatId) {
  const payload = await apiRequest(`/approvals?chatId=${encodeURIComponent(chatId)}`);
  return payload.approvals ?? [];
}

// POST /api/approvals/:id/respond
//   QUESTION -> { answer }         the text is fed back as the tool result
//   ACTION   -> { approved, note } approved runs the deferred call, rejected
//                                  hands the reason back to the model
// Returns { approval, resumed, response }. `resumed` is the background job
// when the paused run was a durable job; `response` is the continuation reply
// for runs that resume inline.
export async function respondApproval(approvalId, { answer, approved, note } = {}) {
  return apiRequest(`/approvals/${encodeURIComponent(approvalId)}/respond`, {
    method: "POST",
    body: { answer, approved, note },
  });
}
