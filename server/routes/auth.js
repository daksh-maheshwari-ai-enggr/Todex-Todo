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

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required." });
  }

  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const normalizedEmail = normalizeEmail(email);

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "Email already registered." });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash,
  });

  return res.status(201).json({
    token: createToken(user.id),
    user: userToPublic(user),
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }

  const user = await findUserByEmail(normalizeEmail(email));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  return res.json({
    token: createToken(user.id),
    user: userToPublic(user),
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: userToPublic(req.user) });
});

export default router;