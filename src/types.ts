export type Side = "LONG" | "SHORT";
export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
export type PositionStatus = "OPEN" | "CLOSED" | "LIQUIDATED";

export type UserId = number;
export type OrderId = number;
export type FillId = number;
export type LiquidationId = number;
export type MarketSymbol = string;

export type User = {
  userId: UserId;
  username: string;
  passwordHash: string;
  availableCollateral: number;
  lockedCollateral: number;
  createdAt: Date;
};

export type Session = {
  token: string;
  userId: UserId;
  createdAt: Date;
};

export type Market = {
  symbol: MarketSymbol;
  baseAsset: string;
  quoteAsset: "USDC";
  markPrice: number;
  indexPrice: number;
  maxLeverage: number;
  initialMarginRate: number;
  maintenanceMarginRate: number;
  minOrderSize: number;
  tickSize: number;
};

export type Position = {
  positionId: string;
  userId: UserId;
  market: MarketSymbol;
  side: Side;
  qty: number;
  entryPrice: number;
  margin: number;
  leverage: number;
  realizedPnL: number;
  status: PositionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type Order = {
  orderId: OrderId;
  userId: UserId;
  market: MarketSymbol;
  side: Side;
  orderType: OrderType;
  price: number;
  qty: number;
  filledQty: number;
  remainingQty: number;
  leverage: number;
  marginLocked: number;
  status: OrderStatus;
  createdAt: Date;
};

export type Fill = {
  fillId: FillId;
  market: MarketSymbol;
  price: number;
  qty: number;
  makerOrderId: OrderId;
  takerOrderId: OrderId;
  makerUserId: UserId;
  takerUserId: UserId;
  longUserId: UserId;
  shortUserId: UserId;
  createdAt: Date;
};

export type OrderBookLevel = {
  price: number;
  availableQty: number;
  orderId: OrderId[];
};

export type OrderBook = {
  market: MarketSymbol;
  bids: Map<number, OrderBookLevel>;
  asks: Map<number, OrderBookLevel>;
};

export type Liquidation = {
  liquidationId: LiquidationId;
  userId: UserId;
  market: MarketSymbol;
  positionId: string;
  side: Side;
  qty: number;
  entryPrice: number;
  liquidationPrice: number;
  markPrice: number;
  realizedPnl: number;
  createdAt: Date;
};
