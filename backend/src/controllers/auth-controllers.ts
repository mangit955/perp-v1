import { authSchema } from "../types/auth-schema";
import { sendValidationError } from "../utils/validation";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { createToken } from "../utils/auth";

export async function signup(req: Request, res: Response): Promise<void> {
  const parsedBody = authSchema.safeParse(req.body);

  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { username, password } = parsedBody.data;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });
    res.status(201).json({
      token: createToken({ userId: user.id }),
      userId: user.id,
      username: user.username,
    });
    return;
  } catch {
    res.status(409).json({ error: "username already exists" });
    return;
  }
}

export async function signin(req: Request, res: Response): Promise<void> {
  const parseBody = authSchema.safeParse(req.body);

  if (!parseBody.success) {
    sendValidationError(res, parseBody.error);
    return;
  }
  const { username, password } = parseBody.data;

  try {
    const user = await prisma.user.findUnique({
      where: {
        username,
      },
    });

    if (!user) {
      res.status(401).json({ error: "invalid username or password" });
      return;
    }

    res.status(200).json({
      token: createToken({ userId: user.id }),
      userId: user.id,
      username: user.username,
    });
  } catch {
    res.status(500).json({
      error: "internal server error",
    });
  }
}
