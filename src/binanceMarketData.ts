import { onPriceUpdate } from "./liquidations";
import type { MarketSymbol } from "./types";

type BinanceSymbol = string;

type BinanceMarkPriceUpdate = {
  e: "markPriceUpdate";
  E: number;
  s: BinanceSymbol;
  p: string; // mark price
  i: string; // index price
};

type BinanceCombinedMessage = {
  stream: string;
  data: BinanceMarkPriceUpdate;
};

const BINANCE_FUTURES_WS_BASE = "wss://fstream.binance.com/market/stream";

const binanceToInternalMarket = new Map<BinanceSymbol, MarketSymbol>([
  ["SOLUSDT", "SOL-PERP"],
  ["ETHUSDT", "ETH-PERP"],
]);

const reconnectMinMs = 1_000;
const reconnectMaxMs = 30_000;

let ws: WebSocket | null = null;
let reconnectDelayMs = reconnectMinMs;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function buildStreamUrl(): string {
  const streams = [...binanceToInternalMarket.keys()]
    .map((symbol) => `${symbol.toLowerCase()}@markPrice@1s`)
    .join("/");

  return `${BINANCE_FUTURES_WS_BASE}?streams=${streams}`;
}

function toNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function readMessageData(data: MessageEvent["data"]): Promise<string> {
  if (typeof data === "string") return data;
  return await new Response(data).text();
}

function handleMarkPriceUpdate(update: BinanceMarkPriceUpdate): void {
  const market = binanceToInternalMarket.get(update.s);
  if (!market) return;

  const markPrice = toNumber(update.p);
  const indexPrice = toNumber(update.i);

  if (!markPrice || !indexPrice) return;

  onPriceUpdate(market, markPrice, indexPrice);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBinanceMarketData();
  }, reconnectDelayMs);

  reconnectDelayMs = Math.min(reconnectDelayMs * 2, reconnectMaxMs);
}

export function startBinanceMarketData(): void {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;

  ws = new WebSocket(buildStreamUrl());

  ws.onopen = () => {
    reconnectDelayMs = reconnectMinMs;
    console.log("Binance market data connected");
  };

  ws.onmessage = async (event) => {
    try {
      const raw = await readMessageData(event.data);
      const message = JSON.parse(raw) as BinanceCombinedMessage;

      if (message.data?.e !== "markPriceUpdate") return;

      handleMarkPriceUpdate(message.data);
    } catch (error) {
      console.error("Failed to process Binance market data", error);
    }
  };

  ws.onerror = (error) => {
    console.error("Binance market data websocket error", error);
    ws?.close();
  };

  ws.onclose = () => {
    ws = null;
    console.log("Binance market data disconnected");
    scheduleReconnect();
  };
}

export function stopBinanceMarketData(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  ws?.close();
  ws = null;
}
