import { getPositionKey } from "./helper";
import {
  CalculateMaintainenceMargine,
  positionEquity,
  unrealisedPnL,
} from "./risks";
import {
  fills,
  liquidations,
  marketsBySymbol,
  ordersById,
  positionsByUserMarket,
} from "./status";
import type { MarketSymbol, User } from "./types";

export function getAvailableEquity(user: User) {
  let positionMargin = 0;
  let totalUnrealizedPnl = 0;

  for (const position of positionsByUserMarket.values()) {
    if (position.userId !== user.userId) continue;
    if (position.status !== "OPEN") continue;

    const market = marketsBySymbol.get(position.market);
    if (!market) continue;

    positionMargin += position.margin;
    totalUnrealizedPnl += unrealisedPnL(position, market.markPrice);
  }

  return {
    userId: user.userId,
    availableCollateral: user.availableCollateral,
    lockedCollateral: user.lockedCollateral,
    positionMargin,
    totalUnrealizedPnl,
    totalEquity:
      user.availableCollateral +
      user.lockedCollateral +
      positionMargin +
      totalUnrealizedPnl,
  };
}

export function getOpenPosition(user: User, marketId: MarketSymbol) {
  const position = positionsByUserMarket.get(
    getPositionKey(user.userId, marketId),
  );

  if (!position || position.status !== "OPEN") return null;

  const market = marketsBySymbol.get(position.market);
  const unrealizedPnl = market ? unrealisedPnL(position, market.markPrice) : 0;

  return {
    ...position,
    markPrice: market?.markPrice ?? null,
    unrealizedPnl,
    positionEquity: market ? positionEquity(position, market.markPrice) : null,
    maintenanceMargin: market
      ? CalculateMaintainenceMargine(position, market)
      : null,
  };
}

export function getClosedPositions(user: User, marketId: MarketSymbol) {
  const position = positionsByUserMarket.get(
    getPositionKey(user.userId, marketId),
  );

  return {
    positions: position && position.status !== "OPEN" ? [position] : [],
    liquidations: liquidations.filter(
      (liquidation) =>
        liquidation.userId === user.userId && liquidation.market === marketId,
    ),
  };
}

export function getOpenOrders(user: User, marketId: MarketSymbol) {
  return [...ordersById.values()].filter(
    (order) =>
      order.userId === user.userId &&
      order.market === marketId &&
      (order.status === "OPEN" || order.status === "PARTIALLY_FILLED"),
  );
}

export function getOrders(user: User, marketId: MarketSymbol) {
  return [...ordersById.values()].filter(
    (order) => order.userId === user.userId && order.market === marketId,
  );
}

export function getUserFills(user: User) {
  return fills.filter(
    (fill) =>
      fill.makerUserId === user.userId || fill.takerUserId === user.userId,
  );
}
