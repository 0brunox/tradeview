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

/**
 * Taxa de funding atual do perp (e mark price) — GET /fapi/v1/premiumIndex.
 * `lastFundingRate` vem como fração por período de 8h (0.0001 = 0.01%).
 * → { rate, ratePct, markPrice, nextFundingTime } ou null se o símbolo não tem perp.
 */
export async function fetchFundingRate(symbol) {
  try {
    const url = `${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const r = await res.json();
    if (!r || r.lastFundingRate == null) return null;
    const rate = Number(r.lastFundingRate);
    return {
      rate,
      ratePct: rate * 100,
      markPrice: Number(r.markPrice),
      nextFundingTime: Number(r.nextFundingTime),
    };
  } catch {
    return null;
  }
}

/**
 * Resumo do Open Interest: valor atual em USD e variação nas últimas 24h.
 * Usa o histórico de 1h (24 pontos ≈ 1 dia) para não precisar de outro endpoint.
 * → { oiUsd, oiBase, changePct24h } ou null.
 */
export async function fetchOpenInterestSummary(symbol) {
  try {
    const rows = await fetchOpenInterestHist(symbol, '1h', 25);
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const first = rows[0];
    const changePct24h =
      first.oiUsd > 0 ? ((last.oiUsd - first.oiUsd) / first.oiUsd) * 100 : null;
    return { oiUsd: last.oiUsd, oiBase: last.oiBase, changePct24h, points: rows.length };
  } catch {
    return null;
  }
}
