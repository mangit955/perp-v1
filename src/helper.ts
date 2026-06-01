import type { MarketSymbol, OrderBook, UserId } from "./types";

export function getPositionKey(userId: UserId, market: MarketSymbol): string {
  return `${userId}:${market}`;
}

export function createOrderBook(market: MarketSymbol): OrderBook {
  return {
    market,
    bids: new Map(),
    asks: new Map(),
  };
}
