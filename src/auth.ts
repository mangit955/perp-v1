import type { Request, Response } from "express";
import type { User } from "./types";
import { sessionsByToken, userById } from "./status";
export function createToken(): string {
  return crypto.randomUUID();
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.header("authorization");

  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;

  return authHeader.slice("Bearer ".length);
}

export function getAuthUser(req: Request): User | null {
  const token = getBearerToken(req);
  if (!token) return null;

  const session = sessionsByToken.get(token);
  if (!session) return null;

  return userById.get(session.userId) ?? null;
}

export function requireAuthUser(req: Request, res: Response): User | null {
  const user = getAuthUser(req);

  if (!user) {
    res.status(401).json({ error: "authorized" });
    return null;
  }

  return user;
}
