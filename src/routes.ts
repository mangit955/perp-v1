import { Router } from "express";
import {
  getNextUserId,
  sessionsByToken,
  userById,
  usersByUsername,
} from "./status";
import type { User } from "./types";
import { createToken } from "./auth";

export const router = Router();

router.post("/signup", async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" || username.trim().length === 0) {
    res.status(400).json("username is required");
    return;
  }

  if (typeof password !== "string" || password.length === 0) {
    res.status(400).json("password is required");
    return;
  }

  const normalizeUsername = username.trim();

  if (usersByUsername.has(normalizeUsername)) {
    res.status(409).json({ error: "Username already exists" });
    return;
  }

  const userId = getNextUserId();
  const passwordHash = await Bun.password.hash(password);

  const user: User = {
    userId,
    username: normalizeUsername,
    passwordHash,
    availableCollateral: 0,
    lockedCollateral: 0,
    createdAt: new Date(),
  };

  userById.set(userId, user);
  usersByUsername.set(normalizeUsername, userId);

  const token = createToken();

  sessionsByToken.set(token, {
    token,
    userId,
    createdAt: new Date(),
  });

  res.status(201).json({
    token,
    userId,
    username: user.username,
  });
});

router.post("/signin", async (req, res) => {
  const { username, password } = req.body;

  if (typeof username !== "string" || username.trim().length === 0) {
    res.status(409).json({ error: "username is required" });
    return;
  }

  if (typeof password !== "string" || password.length === 0) {
    res.status(400).json({ error: "password is required" });
    return;
  }

  const normalizedUsername = username.trim();

  const userId = usersByUsername.get(normalizedUsername);

  if (!userId) {
    res.status(409).json({ error: "invalid username" });
    return;
  }

  const user = userById.get(userId);

  if (!user) {
    res.status(409).json({ error: "invalid username or password" });
    return;
  }

  const PasswordValid = await Bun.password.verify(password, user.passwordHash);

  if (!PasswordValid) {
    res.status(409).json({ error: "invalid username or password" });
  }

  const token = createToken();
});
