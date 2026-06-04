import type {
  Fill,
  FillId,
  Liquidation,
  Market,
  MarketSymbol,
  Order,
  OrderBook,
  OrderId,
  Position,
  Session,
  User,
  UserId,
} from "./types";

export const usersById = new Map<UserId, User>();
export const usersByUsername = new Map<string, UserId>();
export const sessionsByToken = new Map<string, Session>();

export const marketsBySymbol = new Map<MarketSymbol, Market>();
export const positionsByUserMarket = new Map<string, Position>();

export const ordersById = new Map<OrderId, Order>();
export const orderBooksByMarket = new Map<MarketSymbol, OrderBook>();

export const fills: Fill[] = [];
export const liquidations: Liquidation[] = [];

export let nextUserId = 1;
export let nextFillId = 1;
export let nextOrderId = 1;

export function getNextUserId(): UserId {
  return nextUserId++;
}

export function getNextFillId(): FillId {
  return nextFillId++;
}

export function getNextOrderId(): OrderId {
  return nextOrderId++;
}
