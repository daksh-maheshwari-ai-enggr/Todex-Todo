// The single place that talks to the Express API.
//
// Responsibilities:
//   * attach the JWT to protected requests
//   * normalize every failure into an ApiError with the server's message
//   * keep the browser ignorant of database credentials and provider keys
//
// Vite proxies /api to Express on port 3000, so relative URLs are used and no
// backend host is ever hardcoded in the client.

const TOKEN_STORAGE_KEY = "todex.token";

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload ?? null;
  }
}

export function getStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode). The in-memory context value
    // still works for the current tab.
  }
}

export async function apiRequest(path, { method = "GET", body, signal, auth = true } = {}) {
  const headers = { Accept: "application/json" };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = getStoredToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("Could not reach the API. Is the server running on port 3000?", 0, null);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const message = payload?.error || `Request failed with status ${response.status}.`;
    const apiError = new ApiError(message, response.status, payload);

    // The respond endpoint returns the already-persisted user message next to
    // the error, so the UI can show it instead of pretending it was lost.
    if (payload?.userMessage) apiError.userMessage = payload.userMessage;
    // A failed dispatch returns the job it recorded so the UI can display it.
    if (payload?.job) apiError.job = payload.job;

    throw apiError;
  }

  return payload;
}
