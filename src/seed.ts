import { createOrderBook } from "./helper";
import { marketsBySymbol, orderBooksByMarket } from "./status";
import type { Market } from "./types";

const seedMarket: Market[] = [
  {
    symbol: "SOL-PERP",
    baseAsset: "SOL",
    quoteAsset: "USDC",
    markPrice: 90,
    indexPrice: 90,
    maxLeverage: 10,
    initialMarginRate: 0.1,
    maintenanceMarginRate: 0.05,
    minOrderSize: 0.1,
    tickSize: 0.01,
  },
  {
    symbol: "ETH-PERP",
    baseAsset: "ETH",
    quoteAsset: "USDC",
    markPrice: 1900,
    indexPrice: 1900,
    maxLeverage: 10,
    initialMarginRate: 0.1,
    maintenanceMarginRate: 0.05,
    minOrderSize: 0.1,
    tickSize: 0.01,
  },
];

export function seedMarkets(): void {
  for (const market of seedMarket) {
    marketsBySymbol.set(market.symbol, { ...market });
    orderBooksByMarket.set(market.symbol, createOrderBook(market.symbol));
  }
}

seedMarkets();
