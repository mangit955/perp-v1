import { getPositionKey } from "./helper";
import { fills, getNextFillId, positionsByUserMarket } from "./status";
import type { Order, OrderBook, OrderType, Side, User } from "./types";

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
  else if (order.remainingQty > 0) order.status = "PARTIALLY_FILLED";
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

// position update helpers
function CanOpenOrIncrease(user: User, side: Side, market: string): boolean {
  const position = positionsByUserMarket.get(
    getPositionKey(user.userId, market),
  );
  return !position || position.status !== "OPEN" || position.side == side;
}

function applyOpeningFill(params: {
  user: User;
  order: Order;
  qty: number;
  price: number;
  margin: number;
  source: "AVAILABLE" | "LOCKED";
}): Result<null> {
  const { user, order, qty, price, margin, source } = params;

  if (!CanOpenOrIncrease(user, order.side, order.market)) {
    return {
      ok: false,
      status: 400,
      error: "opposite-side position updates come in phase 5",
    };
  }

  if (source === "AVAILABLE") {
    if (user.availableCollateral < margin) {
      return { ok: false, status: 400, error: "Insuffient funds!" };
    }
    user.availableCollateral -= margin;
  } else {
    user.lockedCollateral -= margin;
    order.marginLocked -= margin;
  }

  const key = getPositionKey(user.userId, order.market);
  const existing = positionsByUserMarket.get(key);

  if (!existing || existing.status !== "OPEN") {
    positionsByUserMarket.set(key, {
      positionId: key,
      userId: user.userId,
      market: order.market,
      side: order.side,
      qty,
      entryPrice: price,
      margin,
      leverage: order.leverage,
      realizedPnL: 0,
      status: "OPEN",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { ok: true, data: null };
  }

  const newQty = existing.qty + qty;
  existing.entryPrice =
    (existing.qty * existing.entryPrice + qty * price) / newQty;
  existing.qty = newQty;
  existing.margin += margin;
  existing.leverage = (existing.qty * existing.entryPrice) / existing.margin;
  existing.updatedAt = new Date();

  return { ok: true, data: null };
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
