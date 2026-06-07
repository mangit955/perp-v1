import { Router } from "express";
import {
  getNextUserId,
  sessionsByToken,
  usersById,
  usersByUsername,
} from "./status";
import type { User } from "./types";
import { createToken, requireAuthUser } from "./auth";
import { cancelOrder, placeOrder } from "./orders";
import { onPriceUpdate } from "./liquidations";
import {
  getAvailableEquity,
  getClosedPositions,
  getOpenOrders,
  getOpenPosition,
  getOrders,
  getUserFills,
} from "./views";

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

  usersById.set(userId, user);
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

  const user = usersById.get(userId);

  if (!user) {
    res.status(409).json({ error: "invalid username or password" });
    return;
  }

  const PasswordValid = await Bun.password.verify(password, user.passwordHash);

  if (!PasswordValid) {
    res.status(409).json({ error: "invalid username or password" });
    return;
  }

  const token = createToken();

  sessionsByToken.set(token, {
    token,
    userId: user.userId,
    createdAt: new Date(),
  });

  res.json({
    token,
    userId: user.userId,
    username: user.username,
  });
});

router.post("/onramp", async (req, res) => {
  const user = requireAuthUser(req, res);

  if (!user) return;

  const { amount } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    res.status(409).json({ error: "amount must be greater than 0" });
    return;
  }

  user.availableCollateral += amount;

  res.json({
    userId: user.userId,
    availableCollateral: user.availableCollateral,
    lockedCollateral: user.lockedCollateral,
  });
});

router.post("/order", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const result = placeOrder(user, req.body);

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(201).json(result.data);
});

router.delete("/order", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const result = cancelOrder(user, req.body);

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json(result.data);
});

router.get("/equity/available", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  res.json(getAvailableEquity(user));
});

router.get("/positions/open/:marketId", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const marketId = req.params.marketId;
  if (!marketId) {
    res.status(400).json({ error: "marketId is required" });
    return;
  }

  const position = getOpenPosition(user, marketId);
  if (!position) {
    res.status(404).json({ error: "open position not found" });
    return;
  }

  res.json(position);
});

router.get("/positions/closed/:marketId", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const marketId = req.params.marketId;
  if (!marketId) {
    res.status(400).json({ error: "marketId is required" });
    return;
  }

  res.json(getClosedPositions(user, marketId));
});

router.get("/orders/open/:marketId", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const marketId = req.params.marketId;
  if (!marketId) {
    res.status(400).json({ error: "marketId is required" });
    return;
  }

  res.json(getOpenOrders(user, marketId));
});

router.get("/orders/:marketId", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const marketId = req.params.marketId;
  if (!marketId) {
    res.status(400).json({ error: "marketId is required" });
    return;
  }

  res.json(getOrders(user, marketId));
});

router.get("/fills", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  res.json(getUserFills(user));
});

router.post("/price", (req, res) => {
  const { market, markPrice, indexPrice } = req.body;

  if (typeof market !== "string") {
    res.status(400).json({ error: "market is required" });
    return;
  }

  if (
    typeof markPrice !== "number" ||
    !Number.isFinite(markPrice) ||
    markPrice <= 0
  ) {
    res.status(400).json({ error: "markPrice must be greater than 0" });
    return;
  }

  if (
    indexPrice !== undefined &&
    (typeof indexPrice !== "number" ||
      !Number.isFinite(indexPrice) ||
      indexPrice <= 0)
  ) {
    res.status(400).json({ error: "indexPrice must be greater than 0" });
    return;
  }

  try {
    onPriceUpdate(market, markPrice, indexPrice);
    res.json({ market, markPrice, indexPrice: indexPrice ?? markPrice });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});
