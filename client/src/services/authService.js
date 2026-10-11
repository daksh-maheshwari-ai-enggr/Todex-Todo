import { apiRequest, setStoredToken } from "./api.js";

// POST /api/auth/register -> 201 { token, user }
export async function register({ name, email, password }) {
  const payload = await apiRequest("/auth/register", {
    method: "POST",
    body: { name, email, password },
    auth: false,
  });
  setStoredToken(payload.token);
  return payload;
}

// POST /api/auth/login -> { token, user }
export async function login({ email, password }) {
  const payload = await apiRequest("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
  setStoredToken(payload.token);
  return payload;
}

// GET /api/auth/me -> { user }. Used to restore a session from a stored token.
export async function fetchCurrentUser() {
  const payload = await apiRequest("/auth/me");
  return payload.user;
}

// Tokens are stateless JWTs, so logging out only clears the local copy.
export function logout() {
  setStoredToken(null);
}
