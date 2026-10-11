import { apiRequest } from "./api.js";

// Teammates are "Bots" in the API. There is no avatar field to send: the server
// generates the avatar seed, which the UI turns into a deterministic gradient.

// GET /api/bots -> { bots }
export async function listTeammates() {
  const payload = await apiRequest("/bots");
  return payload.bots ?? [];
}

// POST /api/bots -> 201 { bot }
export async function createTeammate({ name, job, instructions }) {
  const payload = await apiRequest("/bots", {
    method: "POST",
    body: { name, job, instructions: instructions || undefined },
  });
  return payload.bot;
}

// PATCH /api/bots/:id -> { bot }. Only the provided fields are updated.
export async function updateTeammate(botId, { name, job, instructions }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (job !== undefined) body.job = job;
  if (instructions !== undefined) body.instructions = instructions;

  const payload = await apiRequest(`/bots/${encodeURIComponent(botId)}`, {
    method: "PATCH",
    body,
  });
  return payload.bot;
}

// DELETE /api/bots/:id -> 204
export async function deleteTeammate(botId) {
  await apiRequest(`/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
}
