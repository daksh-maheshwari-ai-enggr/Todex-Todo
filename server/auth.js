import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { config } from "./config.js";

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = "7d";

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export async function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

export async function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email } });
}

export async function createUser(data) {
  return prisma.user.create({ data });
}

export function userToPublic(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}