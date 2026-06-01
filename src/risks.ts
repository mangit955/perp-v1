import { marketsBySymbol, positionsByUserMarket } from "./status";
import {
  type Market,
  type MarketSymbol,
  type Position,
  type User,
} from "./types";

export function getMarketOrNull(MarketSymbol: MarketSymbol): Market | null {
  return marketsBySymbol.get(MarketSymbol) ?? null;
}

//calculates total
export function calculateNotional(qty: number, price: number): number {
  return qty * price;
}

//required margin = notional / leverage
export function requiredMargin(
  qty: number,
  price: number,
  leverage: number,
): number {
  return calculateNotional(qty, price) / leverage;
}

export function unrealisedPnL(position: Position, markPrice: number): number {
  if (position.side === "LONG") {
    return position.qty * (markPrice - position.entryPrice); //long formula
  }

  return position.qty * (position.entryPrice - markPrice); //Short formula
}

export function positionEquity(position: Position, markPrice: number): number {
  return position.margin + unrealisedPnL(position, markPrice);
}

//formula notional * maintenanceMarginRate
//Minimum equity needed to KEEP position open.
//below this liquidation happens
export function CalculateMaintainenceMargine(
  position: Position,
  market: Market,
): number {
  const notional = calculateNotional(position.qty, market.markPrice);

  return notional * market.maintenanceMarginRate;
}

export function isPositionLiquidable(
  position: Position,
  market: Market,
): boolean {
  const positionalEquity = positionEquity(position, market.markPrice);

  const maintaienceMargine = CalculateMaintainenceMargine(position, market);

  return positionalEquity <= maintaienceMargine;
}

export function isUserLiqisatable(userId: number): boolean {
  //** */
  for (const position of positionsByUserMarket.values()) {
    if (position.userId !== userId) continue;
    if (position.status !== "OPEN") continue;

    const market = marketsBySymbol.get(position.market);
    if (!market) continue;

    if (isPositionLiquidable(position, market)) {
      return true;
    }
  }
  return false;
}

export function validateOrderRisk(params: {
  user: User;
  marketSymbol: MarketSymbol;
  leverage: number;
  price?: number;
  qty: number;
}):
  | { ok: true; market: Market; requiredMargin: number }
  | { ok: false; error: string } {
  const { user, marketSymbol, leverage, price, qty } = params;

  const market = getMarketOrNull(marketSymbol);

  if (!market) {
    return { ok: false, error: "market does not exist" };
  }

  if (qty < market.minOrderSize) {
    return { ok: false, error: "qty is below than min order size" };
  }

  if (leverage <= 0 || leverage > market.maxLeverage) {
    return { ok: false, error: "invalid leverage" };
  }

  if (isUserLiqisatable(user.userId)) {
    return { ok: false, error: "user has liquidable position" };
  }

  const executionPrice = params.price ?? market.markPrice; // fetch price form params if given othrwise fetch markPrice from market
  const margin = requiredMargin(qty, executionPrice, leverage);

  if (user.availableCollateral < margin) {
    return { ok: false, error: "Insufficient balance" };
  }
  return { ok: true, market, requiredMargin: margin };
}
