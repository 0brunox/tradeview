import { API_BASE, IS_DIRECT } from './config.js';
import { fetchCandlesDirect, searchSymbolsDirect } from './binance.js';

export async function fetchCandles(symbol, interval, limit = 500) {
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

/** Search symbols. Empty query returns the popular list. → [{symbol, baseAsset, quoteAsset}] */
export async function searchSymbols(q = '', limit = 20) {
  if (IS_DIRECT) return searchSymbolsDirect(q, limit);

  try {
    const res = await fetch(`${API_BASE}/api/symbols?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.symbols ?? [];
  } catch {
    return [];
  }
}
