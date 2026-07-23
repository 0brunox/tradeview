import { config } from '../config.js';

/**
 * Fetch historical klines from Binance REST and normalize them.
 * Docs: GET /api/v3/klines?symbol=&interval=&limit=
 * Response rows: [ openTime, open, high, low, close, volume, closeTime, ... ]
 */
export async function fetchKlines(symbol, interval, limit = 500) {
  const url =
    `${config.binanceRest}/api/v3/klines` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Binance REST ${res.status}: ${body.slice(0, 200)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Binance REST: unexpected payload');
  return rows.map(normalizeRestKline);
}

function normalizeRestKline(k) {
  return {
    time: Math.floor(k[0] / 1000), // seconds — Lightweight Charts UTCTimestamp
    openTime: k[0], // ms — DB key
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  };
}

/**
 * Fetch every TRADING symbol from Binance exchangeInfo (used by symbol search).
 * Returns [{ symbol, baseAsset, quoteAsset }].
 */
export async function fetchExchangeSymbols() {
  const res = await fetch(`${config.binanceRest}/api/v3/exchangeInfo`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Binance exchangeInfo ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.symbols)) throw new Error('exchangeInfo: unexpected payload');
  return data.symbols
    .filter((s) => s.status === 'TRADING')
    .map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));
}

/** Normalize the `k` object from a @kline WebSocket event. */
export function normalizeWsKline(k) {
  return {
    time: Math.floor(k.t / 1000),
    openTime: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    closed: Boolean(k.x), // true when this candle has finalized
  };
}
