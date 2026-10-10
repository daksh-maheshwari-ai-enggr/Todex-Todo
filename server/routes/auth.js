import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createUser,
  findUserByEmail,
  hashPassword,
  verifyPassword,
  createToken,
  userToPublic,
} from "../auth.js";

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validateName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

function validatePassword(password) {
  if (typeof password !== "string") return null;
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return null;
  }
  return password;
}

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    const normalizedName = validateName(name);
    const normalizedEmail = validateEmail(email);
    const validPassword = validatePassword(password);

    if (!normalizedName || !normalizedEmail || !validPassword) {
      return res.status(400).json({
        error: `A valid name, email and a password of ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters are required.`,
      });
    }

    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const passwordHash = await hashPassword(validPassword);
    const user = await createUser({
      name: normalizedName,
      email: normalizedEmail,
      passwordHash,
    });

    return res.status(201).json({
      token: createToken(user.id),
      user: userToPublic(user),
    });
  } catch (error) {
    console.error("Error registering user:", error?.message);
    return res.status(500).json({ error: "Failed to register user." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ error: "email and password are required." });
    }

    const user = await findUserByEmail(normalizedEmail);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    return res.json({
      token: createToken(user.id),
      user: userToPublic(user),
    });
  } catch (error) {
    console.error("Error logging in:", error?.message);
    return res.status(500).json({ error: "Failed to log in." });
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: userToPublic(req.user) });
});

export default router;
