// Free, browser-direct derivatives data from Binance USDT-M futures.
// Open Interest history is public and sends CORS `Access-Control-Allow-Origin: *`.
// Docs: GET /futures/data/openInterestHist
const BINANCE_FAPI = 'https://fapi.binance.com';

// Binance only accepts these OI-history periods.
const OI_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);

/**
 * Recent open-interest history for a perp symbol (e.g. BTCUSDT).
 * `sumOpenInterestValue / sumOpenInterest` gives the mark price at each point,
 * so callers get position notional AND the price it was opened at, for free.
 * → [{ time, oiUsd, oiBase }]  (empty when the symbol has no Binance perp)
 */
export async function fetchOpenInterestHist(symbol, period = '1h', limit = 500) {
  const p = OI_PERIODS.has(period) ? period : '1h';
  const url =
    `${BINANCE_FAPI}/futures/data/openInterestHist` +
    `?symbol=${encodeURIComponent(symbol)}&period=${p}&limit=${Math.min(limit, 500)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OI ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    time: Math.floor(r.timestamp / 1000),
    oiUsd: Number(r.sumOpenInterestValue),
    oiBase: Number(r.sumOpenInterest),
  }));
}
