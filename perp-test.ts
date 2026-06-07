import { beforeEach, describe, expect, it } from "bun:test";

const configuredBaseUrl = process.env.BASE_URL?.trim();
const BASE_URL =
  configuredBaseUrl?.startsWith("http://") ||
  configuredBaseUrl?.startsWith("https://")
    ? configuredBaseUrl
    : "http://localhost:3000";
const MARKET = "SOL-PERP";
const PASSWORD = "test-password";

type HttpMethod = "GET" | "POST" | "DELETE";
type Side = "LONG" | "SHORT";
type OrderType = "LIMIT" | "MARKET";
type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
type PositionStatus = "OPEN" | "CLOSED" | "LIQUIDATED";

interface RequestOptions {
  token?: string;
  body?: unknown;
  status?: number;
}

interface SessionResponse {
  token: string;
  userId: number;
  username: string;
}

interface CollateralResponse {
  userId: number;
  availableCollateral: number;
  lockedCollateral: number;
}

interface EquityResponse extends CollateralResponse {
  positionMargin: number;
  totalUnrealizedPnl: number;
  totalEquity: number;
}

interface OrderRequest {
  market: string;
  side: Side;
  orderType: OrderType;
  qty: number;
  leverage: number;
  price?: number;
}

interface OrderResponse extends OrderRequest {
  orderId: number;
  userId: number;
  filledQty: number;
  remainingQty: number;
  marginLocked: number;
  status: OrderStatus;
}

interface FillResponse {
  fillId: number;
  market: string;
  price: number;
  qty: number;
  makerOrderId: number;
  takerOrderId: number;
  makerUserId: number;
  takerUserId: number;
  longUserId: number;
  shortUserId: number;
}

interface PositionResponse {
  positionId: string;
  userId: number;
  market: string;
  side: Side;
  qty: number;
  entryPrice: number;
  margin: number;
  leverage: number;
  realizedPnL: number;
  status: PositionStatus;
  markPrice: number | null;
  unrealizedPnl: number;
  positionEquity: number | null;
  maintenanceMargin: number | null;
}

interface ClosedPositionsResponse {
  positions: Array<{
    status: PositionStatus;
    market: string;
    qty: number;
    realizedPnL: number;
  }>;
  liquidations: Array<{
    userId: number;
    market: string;
    qty: number;
    markPrice: number;
    realizedPnl: number;
  }>;
}

async function request<TResponse>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const url = new URL(path, BASE_URL);
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new Error(
      `Could not reach backend at ${BASE_URL}. Start it with: DISABLE_BINANCE_MARKET_DATA=true bun --hot ./index.ts. Original error: ${String(error)}`,
    );
  }

  const text = await response.text();
  let data: unknown = undefined;

  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `${method} ${path} returned non-JSON ${response.status}: ${text.slice(0, 300)}`,
      );
    }
  }

  const expectedStatus = options.status ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} returned ${response.status}, expected ${expectedStatus}: ${text}`,
    );
  }

  return data as TResponse;
}

async function resetExchange(): Promise<void> {
  await request("POST", "/reset", { body: {} });
}

async function signup(
  username: string,
  initialCollateral = 0,
): Promise<SessionResponse> {
  const session = await request<SessionResponse>("POST", "/signup", {
    status: 201,
    body: { username, password: PASSWORD },
  });

  if (initialCollateral > 0) {
    await request<CollateralResponse>("POST", "/onramp", {
      token: session.token,
      body: { amount: initialCollateral },
    });
  }

  return session;
}

async function signin(username: string): Promise<SessionResponse> {
  return request<SessionResponse>("POST", "/signin", {
    body: { username, password: PASSWORD },
  });
}

async function placeOrder(
  session: SessionResponse,
  order: OrderRequest,
): Promise<OrderResponse> {
  return request<OrderResponse>("POST", "/order", {
    status: 201,
    token: session.token,
    body: order,
  });
}

async function getEquity(session: SessionResponse): Promise<EquityResponse> {
  return request<EquityResponse>("GET", "/equity/available", {
    token: session.token,
  });
}

async function getOpenOrders(
  session: SessionResponse,
): Promise<OrderResponse[]> {
  return request<OrderResponse[]>("GET", `/orders/open/${MARKET}`, {
    token: session.token,
  });
}

async function getFills(session: SessionResponse): Promise<FillResponse[]> {
  return request<FillResponse[]>("GET", "/fills", { token: session.token });
}

async function getOpenPosition(
  session: SessionResponse,
): Promise<PositionResponse> {
  return request<PositionResponse>("GET", `/positions/open/${MARKET}`, {
    token: session.token,
  });
}

async function getClosedPositions(
  session: SessionResponse,
): Promise<ClosedPositionsResponse> {
  return request<ClosedPositionsResponse>("GET", `/positions/closed/${MARKET}`, {
    token: session.token,
  });
}

async function updatePrice(markPrice: number): Promise<void> {
  await request("POST", "/price", {
    body: { market: MARKET, markPrice },
  });
}

async function expectRequestError(
  method: HttpMethod,
  path: string,
  status: number,
  options: Omit<RequestOptions, "status"> = {},
): Promise<{ error: string }> {
  return request<{ error: string }>(method, path, {
    ...options,
    status,
  });
}

function limitOrder(
  side: Side,
  price: number,
  qty: number,
  leverage = 1,
): OrderRequest {
  return {
    market: MARKET,
    side,
    orderType: "LIMIT",
    price,
    qty,
    leverage,
  };
}

function marketOrder(
  side: Side,
  qty: number,
  price: number,
  leverage = 1,
): OrderRequest {
  return {
    market: MARKET,
    side,
    orderType: "MARKET",
    price,
    qty,
    leverage,
  };
}

function expectMoney(actual: number, expected: number): void {
  expect(actual).toBeCloseTo(expected, 8);
}

async function seedMatchedPosition(
  makerName: string,
  takerName: string,
  price: number,
  qty: number,
  leverage: number,
): Promise<{ maker: SessionResponse; taker: SessionResponse }> {
  const maker = await signup(makerName, 10_000);
  const taker = await signup(takerName, 10_000);

  await placeOrder(maker, limitOrder("SHORT", price, qty, leverage));
  const response = await placeOrder(
    taker,
    marketOrder("LONG", qty, price, leverage),
  );

  expect(response.status).toBe("FILLED");
  return { maker, taker };
}

beforeEach(async () => {
  await resetExchange();
  await updatePrice(100);
});

describe("Perps API: auth and collateral", () => {
  it("creates users, signs them in, and protects private routes", async () => {
    const created = await signup("alice");
    expect(created).toMatchObject({
      userId: 1,
      username: "alice",
      token: expect.any(String),
    });

    const signedIn = await signin("alice");
    expect(signedIn).toMatchObject({
      userId: created.userId,
      username: "alice",
      token: expect.any(String),
    });

    const duplicate = await expectRequestError("POST", "/signup", 409, {
      body: { username: "alice", password: PASSWORD },
    });
    expect(duplicate.error).toMatch(/exists/i);

    const unauthorized = await expectRequestError(
      "GET",
      "/equity/available",
      401,
    );
    expect(unauthorized.error).toMatch(/unauthorized/i);
  });

  it("onramps collateral and reports total equity", async () => {
    const user = await signup("funded", 1_000);

    const equity = await getEquity(user);
    expectMoney(equity.availableCollateral, 1_000);
    expectMoney(equity.lockedCollateral, 0);
    expectMoney(equity.positionMargin, 0);
    expectMoney(equity.totalEquity, 1_000);
  });
});

describe("Perps API: orders and matching", () => {
  it("rests a limit order and locks margin", async () => {
    const maker = await signup("maker", 1_000);

    const order = await placeOrder(maker, limitOrder("LONG", 100, 5));

    expect(order).toMatchObject({
      userId: maker.userId,
      market: MARKET,
      side: "LONG",
      orderType: "LIMIT",
      price: 100,
      qty: 5,
      filledQty: 0,
      remainingQty: 5,
      marginLocked: 500,
      status: "OPEN",
    });

    const openOrders = await getOpenOrders(maker);
    expect(openOrders).toHaveLength(1);
    expect(openOrders[0]).toMatchObject({ orderId: order.orderId });

    const equity = await getEquity(maker);
    expectMoney(equity.availableCollateral, 500);
    expectMoney(equity.lockedCollateral, 500);
  });

  it("matches a market taker against a resting maker at maker price", async () => {
    const maker = await signup("short-maker", 10_000);
    const taker = await signup("long-taker", 10_000);

    const makerOrder = await placeOrder(
      maker,
      limitOrder("SHORT", 100, 5),
    );
    const takerOrder = await placeOrder(
      taker,
      marketOrder("LONG", 5, 100),
    );

    expect(takerOrder).toMatchObject({
      status: "FILLED",
      filledQty: 5,
      remainingQty: 0,
    });

    const takerFills = await getFills(taker);
    expect(takerFills).toEqual([
      expect.objectContaining({
        price: 100,
        qty: 5,
        makerOrderId: makerOrder.orderId,
        makerUserId: maker.userId,
        takerUserId: taker.userId,
      }),
    ]);

    const makerPosition = await getOpenPosition(maker);
    expect(makerPosition).toMatchObject({
      side: "SHORT",
      qty: 5,
      entryPrice: 100,
      margin: 500,
    });

    const takerPosition = await getOpenPosition(taker);
    expect(takerPosition).toMatchObject({
      side: "LONG",
      qty: 5,
      entryPrice: 100,
      margin: 500,
    });

    expect((await getOpenOrders(maker))).toHaveLength(0);
  });

  it("fills resting makers in price-time priority and stores weighted average entry", async () => {
    const maker105 = await signup("maker-105", 10_000);
    const maker100 = await signup("maker-100", 10_000);
    const maker102 = await signup("maker-102", 10_000);
    const taker = await signup("taker", 10_000);

    await placeOrder(maker105, limitOrder("SHORT", 105, 3, 10));
    await placeOrder(maker100, limitOrder("SHORT", 100, 3, 10));
    await placeOrder(maker102, limitOrder("SHORT", 102, 4, 10));

    const takerOrder = await placeOrder(
      taker,
      marketOrder("LONG", 10, 105, 10),
    );

    expect(takerOrder.status).toBe("FILLED");
    expect((await getFills(taker)).map((fill) => [fill.price, fill.qty])).toEqual(
      [
        [100, 3],
        [102, 4],
        [105, 3],
      ],
    );

    const position = await getOpenPosition(taker);
    expectMoney(position.entryPrice, 102.3);
    expectMoney(position.margin, 102.3);
    expectMoney(position.qty, 10);
  });

  it("partially fills a crossing limit order and rests the remainder", async () => {
    const maker = await signup("maker", 10_000);
    const taker = await signup("taker", 10_000);

    await placeOrder(maker, limitOrder("SHORT", 100, 5, 5));
    const response = await placeOrder(taker, limitOrder("LONG", 105, 10, 5));

    expect(response).toMatchObject({
      status: "PARTIALLY_FILLED",
      filledQty: 5,
      remainingQty: 5,
      marginLocked: 105,
    });

    const openOrders = await getOpenOrders(taker);
    expect(openOrders).toHaveLength(1);
    expect(openOrders[0]).toMatchObject({
      orderId: response.orderId,
      price: 105,
      remainingQty: 5,
      marginLocked: 105,
    });

    const equity = await getEquity(taker);
    expectMoney(equity.availableCollateral, 9_795);
    expectMoney(equity.lockedCollateral, 105);
    expectMoney(equity.positionMargin, 100);
  });

  it("cancels an open order and releases locked margin", async () => {
    const maker = await signup("maker", 1_000);
    const order = await placeOrder(maker, limitOrder("LONG", 100, 5));

    const cancelled = await request<OrderResponse>("DELETE", "/order", {
      token: maker.token,
      body: { orderId: order.orderId },
    });

    expect(cancelled).toMatchObject({
      orderId: order.orderId,
      status: "CANCELLED",
      remainingQty: 0,
      marginLocked: 0,
    });

    const equity = await getEquity(maker);
    expectMoney(equity.availableCollateral, 1_000);
    expectMoney(equity.lockedCollateral, 0);
    expect(await getOpenOrders(maker)).toHaveLength(0);
  });

  it("rejects orders when collateral is insufficient", async () => {
    const trader = await signup("underfunded", 50);

    const response = await expectRequestError("POST", "/order", 400, {
      token: trader.token,
      body: limitOrder("LONG", 100, 10),
    });

    expect(response.error).toMatch(/insufficient|balance|collateral/i);

    const equity = await getEquity(trader);
    expectMoney(equity.availableCollateral, 50);
    expectMoney(equity.lockedCollateral, 0);
  });
});

describe("Perps API: positions, pricing, and liquidation", () => {
  it("updates long and short unrealized PnL from mark price", async () => {
    const { maker: shortMaker, taker: longTaker } = await seedMatchedPosition(
      "short-maker",
      "long-taker",
      100,
      10,
      5,
    );

    await updatePrice(105);

    const longPosition = await getOpenPosition(longTaker);
    const shortPosition = await getOpenPosition(shortMaker);

    expectMoney(longPosition.unrealizedPnl, 50);
    expectMoney(shortPosition.unrealizedPnl, -50);
    expectMoney(longPosition.positionEquity ?? 0, 250);
    expectMoney(shortPosition.positionEquity ?? 0, 150);
  });

  it("liquidates positions when mark price breaches maintenance margin", async () => {
    const maker = await signup("short-maker", 10_000);
    const fragileLong = await signup("fragile-long", 101);

    await placeOrder(maker, limitOrder("SHORT", 100, 10, 10));
    await placeOrder(fragileLong, marketOrder("LONG", 10, 100, 10));

    await updatePrice(95);
    const safePosition = await getOpenPosition(fragileLong);
    expect(safePosition.status).toBe("OPEN");

    await updatePrice(94);
    const missingOpenPosition = await expectRequestError(
      "GET",
      `/positions/open/${MARKET}`,
      404,
      { token: fragileLong.token },
    );
    expect(missingOpenPosition.error).toMatch(/not found/i);

    const closed = await getClosedPositions(fragileLong);
    expect(closed.positions).toEqual([
      expect.objectContaining({
        status: "LIQUIDATED",
        market: MARKET,
      }),
    ]);
    expect(closed.liquidations).toEqual([
      expect.objectContaining({
        userId: fragileLong.userId,
        market: MARKET,
        markPrice: 94,
      }),
    ]);
  });
});
