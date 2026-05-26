import type {
  Fill,
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

export const userById = new Map<UserId, User>();
export const usersByUsername = new Map<string, UserId>();
export const sessionsByToken = new Map<string, Session>();

export const marketsBySymbol = new Map<MarketSymbol, Market>();
export const positionsByUserMarket = new Map<string, Position>();

export const ordersById = new Map<OrderId, Order>();
export const orderBooksByMarket = new Map<MarketSymbol, OrderBook>();

export const fills: Fill[] = [];
export const liquidation: Liquidation[] = [];

export let nextUserId = 1;

export function getNextUserId(): UserId {
  return nextUserId++;
}
