import { apiRequest } from "./api.js";

// Chats, messages, participants and handoffs are all chat-scoped, so they live
// together here. Handoffs are read-only from the client: they are only ever
// created by trusted server-side agent execution.

// GET /api/chats -> { chats } (each chat includes its direct `bot` when direct)
export async function listChats() {
  const payload = await apiRequest("/chats");
  return payload.chats ?? [];
}

// GET /api/chats/:chatId -> { chat } (includes persisted messages)
export async function getChat(chatId) {
  const payload = await apiRequest(`/chats/${encodeURIComponent(chatId)}`);
  return payload.chat;
}

// POST /api/chats with `botId` -> 201 { chat }. Direct 1:1 chat with a teammate.
export async function createChat({ title, botId }) {
  const payload = await apiRequest("/chats", {
    method: "POST",
    body: { title, botId },
  });
  return payload.chat;
}

// POST /api/chats with `botIds` -> 201 { chat }. Group chat with participants.
export async function createGroupChat({ title, botIds }) {
  const payload = await apiRequest("/chats", {
    method: "POST",
    body: { title, botIds },
  });
  return payload.chat;
}

// PATCH /api/chats/:chatId -> { chat }
export async function updateChat(chatId, { title }) {
  const payload = await apiRequest(`/chats/${encodeURIComponent(chatId)}`, {
    method: "PATCH",
    body: { title },
  });
  return payload.chat;
}

// DELETE /api/chats/:chatId -> 204
export async function deleteChat(chatId) {
  await apiRequest(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
}

// GET /api/messages/:chatId -> { messages }
export async function listMessages(chatId) {
  const payload = await apiRequest(`/messages/${encodeURIComponent(chatId)}`);
  return payload.messages ?? [];
}

// POST /api/agents/:botId/respond -> 201 { response, userMessage, assistantMessage }
//
// This is the endpoint that actually produces a teammate reply. It persists the
// user message AND the assistant reply itself, so the UI does not call
// POST /api/messages separately for the same text. Participants and the
// teammate's identity are resolved server-side, never from the browser.
export async function requestTeammateResponse({ botId, chatId, message, signal }) {
  return apiRequest(`/agents/${encodeURIComponent(botId)}/respond`, {
    method: "POST",
    body: { chatId, message },
    signal,
  });
}

// GET /api/chats/:chatId/participants -> { participants }
export async function listParticipants(chatId) {
  const payload = await apiRequest(`/chats/${encodeURIComponent(chatId)}/participants`);
  return payload.participants ?? [];
}

// POST /api/chats/:chatId/participants -> 201 { participant }
export async function addParticipant(chatId, botId) {
  const payload = await apiRequest(`/chats/${encodeURIComponent(chatId)}/participants`, {
    method: "POST",
    body: { botId },
  });
  return payload.participant;
}

// DELETE /api/chats/:chatId/participants/:botId -> 204
export async function removeParticipant(chatId, botId) {
  await apiRequest(
    `/chats/${encodeURIComponent(chatId)}/participants/${encodeURIComponent(botId)}`,
    { method: "DELETE" },
  );
}

// GET /api/handoffs/:chatId -> { handoffs, nextCursor }. Read-only history of
// teammate-to-teammate delegations for the chat.
export async function listHandoffs(chatId, { limit, cursor } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();

  return apiRequest(`/handoffs/${encodeURIComponent(chatId)}${query ? `?${query}` : ""}`);
}
