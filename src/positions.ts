import { positionsByUserMarket, positionsByUserMarket } from "./status";
import { getPositionKey } from "./helper";
import type { Order, Position, User } from "./types";

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

type marginSource =
  | { kind: "AVAILABLE" }
  | { kind: "LOCKED"; locledMarginForFill: number };

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
  const realisedPnL = isOpposite ? closePnL(positions, closeQty, price) : 0;
  const realsedMargin = isOpposite
    ? positions.margin * (closeQty / positions.qty)
    : 0;
}
