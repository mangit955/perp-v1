import { getPositionKey } from "./helper";
import { requiredMargin, validateOrderRisk } from "./risks";
import { liquidationScanner } from "./liquidations";
import { applyTradePosition } from "./positions";
import {
  fills,
  getNextFillId,
  getNextOrderId,
  orderBooksByMarket,
  ordersById,
  positionsByUserMarket,
  usersById,
} from "./status";
import type {
  Market,
  Order,
  OrderBook,
  OrderId,
  OrderType,
  Side,
  User,
} from "./types";

const SYSTEM_USER_ID = 0;
const SYSTEM_ORDER_ID = 0;

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

function parseSide(value: unknown): Side | null {
  const side = String(value).toUpperCase();
  return side === "LONG" || side === "SHORT" ? side : null;
}

function parseOrderType(value: unknown): OrderType | null {
  const orderType = String(value).toUpperCase();
  return orderType === "MARKET" || orderType === "LIMIT" ? orderType : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function setOrderStatus(order: Order): void {
  if (order.remainingQty <= 0) order.status = "FILLED";
  else if (order.filledQty > 0) order.status = "PARTIALLY_FILLED";
  else order.status = "OPEN";
}

function ownBookSide(book: OrderBook, side: Side) {
  return side === "LONG" ? book.bids : book.asks;
}

function oppositeBookSide(book: OrderBook, side: Side) {
  return side === "LONG" ? book.asks : book.bids;
}

function sortedPrice(
  bookSide: Map<number, { price: number }>,
  takerSide: Side,
): number[] {
  const prices = [...bookSide.keys()];
  return takerSide === "LONG"
    ? prices.sort((a, b) => a - b) //ascending order
    : prices.sort((a, b) => b - a); // descending order
}

function crosses(side: Side, takerPrice: number, makerPrice: number): boolean {
  return side === "LONG" ? takerPrice >= makerPrice : takerPrice <= makerPrice;
}

function getOpeningQty(user: User, side: Side, market: string, qty: number) {
  const position = positionsByUserMarket.get(
    getPositionKey(user.userId, market),
  );

  if (!position || position.status !== "OPEN" || position.qty <= 0) {
    return qty;
  }

  if (position.side === side) {
    return qty;
  }

  return Math.max(0, qty - position.qty);
}

function recordFills(params: {
  takerOrder: Order;
  makerOrder?: Order;
  price: number;
  qty: number;
}) {
  const { takerOrder, makerOrder, price, qty } = params;

  fills.push({
    fillId: getNextFillId(),
    market: takerOrder.market,
    price,
    qty,
    makerOrderId: makerOrder?.orderId ?? SYSTEM_ORDER_ID,
    takerOrderId: takerOrder.orderId,
    makerUserId: makerOrder?.userId ?? SYSTEM_USER_ID,
    takerUserId: takerOrder.userId,
    longUserId:
      takerOrder.side === "LONG"
        ? takerOrder.userId
        : (makerOrder?.userId ?? SYSTEM_USER_ID),
    shortUserId:
      takerOrder.side === "SHORT"
        ? takerOrder.userId
        : (makerOrder?.userId ?? SYSTEM_USER_ID),
    createdAt: new Date(),
  });
}

function addOrderToBook(book: OrderBook, order: Order): void {
  const side = ownBookSide(book, order.side); // find side

  let level = side.get(order.price); // find price level

  if (!level) {
    level = { price: order.price, availableQty: 0, orderId: [] };
    side.set(order.price, level);
  }
  level.availableQty += order.remainingQty;
  level.orderId.push(order.orderId);
}

function removeOrderFromBook(book: OrderBook, order: Order): void {
  const side = ownBookSide(book, order.side);
  let level = side.get(order.price);

  if (!level) return;

  level.orderId = level.orderId.filter((id) => id !== order.orderId);
  level.availableQty -= order.remainingQty;

  if (level.orderId.length === 0 || level.availableQty <= 0) {
    side.delete(order.price);
  }
}

export function placeOrder(user: User, body: unknown): Result<Order> {
  const input = body as Record<string, unknown>;

  const market = typeof input.market === "string" ? input.market : null;
  const side = parseSide(input.side);
  const orderType = parseOrderType(input.orderType);
  const qty = positiveNumber(input.qty);
  const leverage = positiveNumber(input.leverage);
  const price =
    input.price === undefined ? undefined : positiveNumber(input.price);

  if (!market || !side || !orderType || !qty || !leverage) {
    return { ok: false, status: 400, error: "invalid order body" };
  }

  if (orderType === "LIMIT" && !price) {
    return { ok: false, status: 400, error: "limit orders require price" };
  }

  const risk = validateOrderRisk({
    user,
    marketSymbol: market,
    side,
    qty,
    leverage,
    price: price ?? undefined,
  });
  if (!risk.ok) {
    return { ok: false, status: 400, error: risk.error };
  }

  const book = orderBooksByMarket.get(market);
  if (!book)
    return { ok: false, status: 400, error: "orderbook does not exist" };

  const order: Order = {
    orderId: getNextOrderId(),
    userId: user.userId,
    market,
    side,
    orderType,
    price: orderType === "LIMIT" ? price! : risk.market.markPrice,
    qty,
    filledQty: 0,
    remainingQty: qty,
    leverage,
    marginLocked: 0,
    status: "OPEN",
    createdAt: new Date(),
  };

  ordersById.set(order.orderId, order);

  const matchResult = matchAgainstBook(user, order, book);
  if (!matchResult.ok) return matchResult;

  if (order.orderType === "MARKET" && order.remainingQty > 0) {
    const markResult = fillAgainstMarkPrice(user, order, risk.market);
    if (!markResult.ok) return markResult;
  }

  if (order.orderType === "LIMIT" && order.remainingQty > 0) {
    const openingQty = getOpeningQty(
      user,
      order.side,
      order.market,
      order.remainingQty,
    );
    const marginToLock =
      openingQty > 0
        ? requiredMargin(openingQty, order.price, order.leverage)
        : 0;

    if (user.availableCollateral < marginToLock) {
      return {
        ok: false,
        status: 400,
        error: "insufficient collateral to rest order",
      };
    }

    user.availableCollateral -= marginToLock;
    user.lockedCollateral += marginToLock;
    order.marginLocked = marginToLock;
    addOrderToBook(book, order);
  }

  setOrderStatus(order);
  liquidationScanner(order.market);
  return { ok: true, data: order };
}

function matchAgainstBook(
  user: User,
  takerOrder: Order,
  book: OrderBook,
): Result<null> {
  const opposite = oppositeBookSide(book, takerOrder.side);

  for (const price of sortedPrice(opposite, takerOrder.side)) {
    if (takerOrder.remainingQty <= 0) break;
    if (
      takerOrder.orderType === "LIMIT" &&
      !crosses(takerOrder.side, takerOrder.price, price)
    )
      break;

    const level = opposite.get(price);
    if (!level) continue;

    for (const makerOrderId of [...level.orderId]) {
      if (takerOrder.remainingQty <= 0) break;

      const makerOrder = ordersById.get(makerOrderId);
      if (!makerOrder || makerOrder.remainingQty <= 0) continue;

      const makerUser = usersById.get(makerOrder.userId);
      if (!makerUser) continue;

      const fillQty = Math.min(
        takerOrder.remainingQty,
        makerOrder.remainingQty,
      );
      const makerOpeningQty = getOpeningQty(
        makerUser,
        makerOrder.side,
        makerOrder.market,
        fillQty,
      );
      const makerMargin =
        makerOpeningQty > 0
          ? requiredMargin(makerOpeningQty, price, makerOrder.leverage)
          : 0;

      const makerResult = applyTradePosition({
        user: makerUser,
        order: makerOrder,
        qty: fillQty,
        price,
        source: { kind: "LOCKED", lockedMarginForFill: makerMargin },
      });
      if (!makerResult.ok) return makerResult;

      const takerResult = applyTradePosition({
        user,
        order: takerOrder,
        qty: fillQty,
        price,
        source: { kind: "AVAILABLE" },
      });
      if (!takerResult.ok) return takerResult;

      makerOrder.filledQty += fillQty;
      makerOrder.remainingQty -= fillQty;
      takerOrder.filledQty += fillQty;
      takerOrder.remainingQty -= fillQty;
      level.availableQty -= fillQty;

      setOrderStatus(makerOrder);
      setOrderStatus(takerOrder);
      recordFills({ takerOrder, makerOrder, price, qty: fillQty });

      if (makerOrder.remainingQty <= 0) {
        level.orderId = level.orderId.filter((id) => id !== makerOrderId);
      }
    }

    if (level.orderId.length === 0 || level.availableQty <= 0) {
      opposite.delete(price);
    }
  }

  return { ok: true, data: null };
}

function fillAgainstMarkPrice(
  user: User,
  order: Order,
  market: Market,
): Result<null> {
  const qty = order.remainingQty;
  const price = market.markPrice;

  const result = applyTradePosition({
    user,
    order,
    qty,
    price,
    source: { kind: "AVAILABLE" },
  });

  if (!result.ok) return result;

  order.filledQty += qty;
  order.remainingQty = 0;
  setOrderStatus(order);
  recordFills({ takerOrder: order, price, qty });

  return { ok: true, data: null };
}

export function cancelOrder(user: User, body: unknown): Result<Order> {
  const input = body as Record<string, unknown>;
  const orderId = input.orderId;

  if (typeof orderId !== "number" || !Number.isInteger(orderId)) {
    return { ok: false, status: 400, error: "orderId is required" };
  }

  const order = ordersById.get(orderId as OrderId);
  if (!order) return { ok: false, status: 404, error: "order not found" };

  if (order.userId !== user.userId) {
    return {
      ok: false,
      status: 403,
      error: "cannot cancel another user's order",
    };
  }

  if (order.status !== "OPEN" && order.status !== "PARTIALLY_FILLED") {
    return { ok: false, status: 400, error: "order is not cancellable" };
  }

  const book = orderBooksByMarket.get(order.market);
  if (book) removeOrderFromBook(book, order);

  user.lockedCollateral -= order.marginLocked;
  user.availableCollateral += order.marginLocked;

  order.marginLocked = 0;
  order.remainingQty = 0;
  order.status = "CANCELLED";

  return { ok: true, data: order };
}
