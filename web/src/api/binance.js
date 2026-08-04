// Direct-to-Binance data source (no backend). Used when VITE_DATA_SOURCE=binance.
import { BINANCE_REST, BINANCE_WS } from './config.js';

export async function fetchCandlesDirect(symbol, interval, limit = 500) {
  const url =
    `${BINANCE_REST}/api/v3/klines` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Binance ${res.status}: ${body.slice(0, 160)}`);
  }
  const rows = await res.json();
  return rows.map((k) => ({
    time: Math.floor(k[0] / 1000),
    openTime: k[0],
    open: +k[1],
    high: +k[2],
    low: +k[3],
    close: +k[4],
    volume: +k[5],
  }));
}

// --- symbol search over the lightweight ticker/price list (~150 KB) ---
// Quote assets, longest/most-specific first, to split "BASEQUOTE" symbols.
const QUOTES = [
  'USDT', 'FDUSD', 'USDC', 'TUSD', 'BUSD', 'USDP', 'AEUR', 'DAI', 'USD',
  'BTC', 'ETH', 'BNB', 'TRY', 'EUR', 'BRL', 'GBP', 'AUD', 'JPY', 'ARS',
  'ZAR', 'MXN', 'PLN', 'RON', 'CZK', 'UAH', 'NGN', 'IDRT', 'BIDR',
  'DOGE', 'XRP', 'SOL', 'TRX', 'DOT', 'PAX',
];
const POPULAR = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT',
];

const rankQuote = (q) => (q === 'USDT' ? 0 : q === 'USDC' || q === 'FDUSD' ? 1 : 2);
const compare = (a, b) =>
  rankQuote(a.quoteAsset) - rankQuote(b.quoteAsset) ||
  a.symbol.length - b.symbol.length ||
  a.symbol.localeCompare(b.symbol);

function splitSymbol(sym) {
  for (const q of QUOTES) {
    if (sym.length > q.length && sym.endsWith(q)) {
      return { baseAsset: sym.slice(0, -q.length), quoteAsset: q };
    }
  }
  return { baseAsset: sym, quoteAsset: '' };
}

const LS_KEY = 'tradeview:symbols';
const TTL = 12 * 60 * 60 * 1000;
let cache = null;

async function loadSymbols() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const { at, list } = JSON.parse(raw);
      if (Array.isArray(list) && list.length && Date.now() - at < TTL) {
        cache = list;
        return cache;
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(`${BINANCE_REST}/api/v3/ticker/price`);
    const rows = await res.json();
    cache = rows.map((r) => ({ symbol: r.symbol, ...splitSymbol(r.symbol) }));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ at: Date.now(), list: cache }));
    } catch { /* quota — fine */ }
  } catch {
    cache = POPULAR.map((s) => ({ symbol: s, baseAsset: s.replace(/USDT$/, ''), quoteAsset: 'USDT' }));
  }
  return cache;
}

export async function searchSymbolsDirect(q = '', limit = 20) {
  const query = String(q).trim().toUpperCase();
  const list = await loadSymbols();

  if (!query) {
    const byName = new Map(list.map((s) => [s.symbol, s]));
    const popular = POPULAR.map((s) => byName.get(s)).filter(Boolean);
    return (popular.length ? popular : [...list].sort(compare)).slice(0, limit);
  }

  const starts = [];
  const contains = [];
  for (const s of list) {
    if (s.symbol.startsWith(query) || s.baseAsset === query) starts.push(s);
    else if (s.symbol.includes(query)) contains.push(s);
  }
  starts.sort(compare);
  contains.sort(compare);
  return [...starts, ...contains].slice(0, limit);
}

// 24h ticker (price + change%) for a set of symbols — used by the watchlist.
// Public market data; called directly against Binance in either data-source mode.
export async function fetchTickers(symbols) {
  if (!symbols || symbols.length === 0) return [];
  try {
    const param = encodeURIComponent(JSON.stringify(symbols));
    const res = await fetch(`${BINANCE_REST}/api/v3/ticker/24hr?symbols=${param}`);
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r) => ({
      symbol: r.symbol,
      price: +r.lastPrice,
      changePct: +r.priceChangePercent,
    }));
  } catch {
    return [];
  }
}

// Estatísticas 24h completas de um símbolo (spot) — usadas pela análise de IA.
// → { price, changePct, high, low, volume, quoteVolume, weightedAvg } ou null.
export async function fetchTicker24h(symbol) {
  try {
    const res = await fetch(`${BINANCE_REST}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const r = await res.json();
    return {
      price: +r.lastPrice,
      changePct: +r.priceChangePercent,
      high: +r.highPrice,
      low: +r.lowPrice,
      volume: +r.volume,
      quoteVolume: +r.quoteVolume,
      weightedAvg: +r.weightedAvgPrice,
    };
  } catch {
    return null;
  }
}

// --- live klines straight from the Binance stream ---
export class BinanceLiveClient {
  constructor({ onCandle, onStatus } = {}) {
    this.onCandle = onCandle ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.sub = null;
    this.ws = null;
    this.closedByUser = false;
  }

  subscribe(symbol, interval) {
    this.sub = { symbol, interval };
    this.open();
  }

  open() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    if (!this.sub || this.closedByUser) return;
    const { symbol, interval } = this.sub;
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    this.onStatus('connecting');
    const ws = new WebSocket(`${BINANCE_WS}/ws/${stream}`);
    this.ws = ws;

    ws.onopen = () => this.onStatus('open');
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      const k = m.k;
      if (!k) return;
      this.onCandle(
        {
          time: Math.floor(k.t / 1000),
          openTime: k.t,
          open: +k.o,
          high: +k.h,
          low: +k.l,
          close: +k.c,
          volume: +k.v,
          closed: !!k.x,
        },
        symbol,
        interval,
      );
    };
    ws.onclose = () => {
      this.onStatus('closed');
      if (!this.closedByUser && this.sub) setTimeout(() => this.open(), 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  close() {
    this.closedByUser = true;
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
