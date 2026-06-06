import { unrealisedPnL } from "./risks";
import {
  getNextLiquidationId,
  liquidations,
  marketsBySymbol,
  orderBooksByMarket,
  ordersById,
  usersById,
} from "./status";
import type { MarketSymbol, Order, Position } from "./types";

function removeFromBook(order: Order): void {
  const book = orderBooksByMarket.get(order.market);
  if (!book) return;
  const side = order.side === "LONG" ? book.bids : book.asks;
  const level = side.get(order.price);
  if (!level) return;

  level.orderId = level.orderId.filter((id) => id !== order.orderId);
  level.availableQty -= order.remainingQty;

  if (level.orderId.length === 0 || level.availableQty <= 0) {
    side.delete(order.price);
  }
}

function cancelOpenOrdersForUserMarket(
  userId: number,
  market: MarketSymbol,
): void {
  const user = usersById.get(userId);
  if (!user) return;

  for (const order of ordersById.values()) {
    if (order.userId !== userId || order.market !== market) continue;
    if (order.status !== "OPEN" && order.status !== "PARTIALLY_FILLED")
      continue;

    removeFromBook(order);
    user.lockedCollateral -= order.marginLocked;
    user.availableCollateral += order.marginLocked;
    order.marginLocked = 0;
    order.remainingQty = 0;
    order.status = "CANCELLED";
  }
}

function liquidatePosition(position: Position): void {
  const user = usersById.get(position.userId);
  const market = marketsBySymbol.get(position.market);

  if (!user || !market || position.status !== "OPEN") return;
  cancelOpenOrdersForUserMarket(position.userId, position.market);

  const realizedPnl = unrealisedPnL(position, market.markPrice);
  user.availableCollateral += position.margin + realizedPnl;

  liquidations.push({
    liquidationId: getNextLiquidationId(),
    userId: position.userId,
    market: position.market,
    positionId: position.positionId,
    side: position.side,
    qty: position.qty,
    entryPrice: position.entryPrice,
    liquidationPrice: market.markPrice,
    markPrice: market.markPrice,
    realizedPnl,
    createdAt: new Date(),
  });

  position.qty = 0;
  position.margin = 0;
  position.realizedPnL += realizedPnl;
  position.status = "LIQUIDATED";
  position.updatedAt = new Date();
}
