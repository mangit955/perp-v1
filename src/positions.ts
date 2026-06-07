import { positionsByUserMarket } from "./status";
import { getPositionKey } from "./helper";
import type { Order, Position, User } from "./types";
import { requiredMargin } from "./risks";

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

type marginSource =
  | { kind: "AVAILABLE" }
  | { kind: "LOCKED"; lockedMarginForFill: number };

function closePnL(position: Position, price: number, qty: number): number {
  return position.side === "LONG"
    ? qty * (price - position.entryPrice)
    : qty * (position.entryPrice - price);
}

export function applyTradePosition(params: {
  user: User;
  order: Order;
  price: number;
  qty: number;
  source: marginSource;
}): Result<{ realisedPnL: number }> {
  const { user, order, qty, price, source } = params;
  const key = getPositionKey(user.userId, order.market);
  const positions = positionsByUserMarket.get(key);
  const isOpen = positions && positions.status === "OPEN" && positions.qty > 0;
  const isOpposite = isOpen && positions.side !== order.side;
  const closeQty = isOpposite ? Math.min(qty, positions.qty) : 0;
  const openQty = isOpposite ? qty - closeQty : qty;
  const realisedPnL = isOpposite ? closePnL(positions, price, closeQty) : 0;
  const releasedMargin = isOpposite
    ? positions.margin * (closeQty / positions.qty)
    : 0;
  const openingMargin =
    openQty > 0 ? requiredMargin(openQty, price, order.leverage) : 0;

  if (source.kind === "AVAILABLE") {
    if (
      user.availableCollateral + releasedMargin + realisedPnL <
      openingMargin
    ) {
      return { ok: false, status: 400, error: "insufficient collateral" };
    }
    user.availableCollateral += releasedMargin + realisedPnL - openingMargin;
  } else {
    if (source.lockedMarginForFill < openingMargin) {
      return { ok: false, status: 400, error: "locked margin is insufficient" };
    }
    user.lockedCollateral -= source.lockedMarginForFill;
    order.marginLocked -= source.lockedMarginForFill;
    user.availableCollateral +=
      releasedMargin + realisedPnL + source.lockedMarginForFill - openingMargin;
  }

  if (!isOpen) {
    positionsByUserMarket.set(key, {
      positionId: key,
      userId: user.userId,
      market: order.market,
      side: order.side,
      qty: openQty,
      entryPrice: price,
      margin: openingMargin,
      leverage: order.leverage,
      realizedPnL: 0,
      status: "OPEN",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { ok: true, data: { realisedPnL } };
  }

  if (!isOpposite) {
    const newQty = positions.qty + openQty;
    positions.entryPrice =
      (positions.qty * positions.entryPrice + openQty * price) / newQty;
    positions.qty = newQty;
    positions.margin += openingMargin;
    positions.leverage =
      (positions.qty * positions.entryPrice) / positions.margin;
  } else if (closeQty < positions.qty) {
    positions.qty -= closeQty;
    positions.margin -= releasedMargin;
    positions.realizedPnL += realisedPnL;
  } else if (openQty > 0) {
    positions.side = order.side;
    positions.qty = openQty;
    positions.entryPrice = price;
    positions.margin = openingMargin;
    positions.leverage = order.leverage;
    positions.realizedPnL += realisedPnL;
    positions.status = "OPEN";
  } else {
    positions.qty = 0;
    positions.margin = 0;
    positions.realizedPnL += realisedPnL;
    positions.status = "CLOSED";
  }

  positions.updatedAt = new Date();
  return { ok: true, data: { realisedPnL } };
}
