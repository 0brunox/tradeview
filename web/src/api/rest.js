import { API_BASE, IS_DIRECT } from './config.js';
import { fetchCandlesDirect, searchSymbolsDirect, fetchTickers as fetchTickersBinance } from './binance.js';
import { fetchCandlesBybit, searchSymbolsBybit, fetchTickersBybit } from './bybit.js';
import { parseSymbol, groupBySource } from './source.js';

export async function fetchCandles(fullSymbol, interval, limit = 500) {
  const { source, symbol } = parseSymbol(fullSymbol);
  if (source === 'bybit') return fetchCandlesBybit(symbol, interval, limit);

  // binance
  if (IS_DIRECT) return fetchCandlesDirect(symbol, interval, limit);
  const url = `${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.candles;
}

// Binance symbol search (direct or via backend), tagged with source.
async function searchBinance(q, limit) {
  let rows = [];
  if (IS_DIRECT) {
    rows = await searchSymbolsDirect(q, limit);
  } else {
    try {
      const res = await fetch(`${API_BASE}/api/symbols?q=${encodeURIComponent(q)}&limit=${limit}`);
      if (res.ok) rows = (await res.json()).symbols ?? [];
    } catch { rows = []; }
  }
  return rows.map((r) => ({ ...r, source: 'binance' }));
}

/**
 * Search symbols across sources. Empty query returns the Binance popular list.
 * A real query also queries Bybit and appends its matches (prefixed BYBIT:).
 * → [{ symbol, baseAsset, quoteAsset, source }]
 */
export async function searchSymbols(q = '', limit = 20) {
  const query = String(q).trim();
  const bin = await searchBinance(q, limit);
  if (!query) return bin;

  let byb = [];
  try { byb = await searchSymbolsBybit(query, 12); } catch { byb = []; }
  return [...bin, ...byb].slice(0, limit + 12);
}

/**
 * 24h tickers for a mixed list of full symbols, routed per source.
 * → [{ symbol (full, prefixed for non-Binance), price, changePct }]
 */
export async function fetchTickers(fullSymbols) {
  if (!fullSymbols || fullSymbols.length === 0) return [];
  const groups = groupBySource(fullSymbols);
  const out = [];
  const jobs = [];
  if (groups.binance?.length) {
    jobs.push(
      fetchTickersBinance(groups.binance).then((rows) => {
        for (const r of rows) out.push(r); // bare === full for Binance
      }),
    );
  }
  if (groups.bybit?.length) {
    jobs.push(
      fetchTickersBybit(groups.bybit).then((rows) => {
        for (const r of rows) out.push({ ...r, symbol: `BYBIT:${r.symbol}` });
      }),
    );
  }
  await Promise.all(jobs);
  return out;
}
