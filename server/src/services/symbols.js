import { fetchExchangeSymbols } from '../providers/binance.js';

// Shown first when the search box is empty.
const POPULAR = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'TRXUSDT',
];

const TTL = 60 * 60 * 1000; // refresh the symbol list at most once per hour
let cache = { at: 0, list: [] };

async function loadSymbols() {
  const now = Date.now();
  if (cache.list.length && now - cache.at < TTL) return cache.list;
  try {
    const list = await fetchExchangeSymbols();
    cache = { at: now, list };
    return list;
  } catch (err) {
    console.warn(`[symbols] exchangeInfo failed (${err.message}) — using fallback`);
    if (cache.list.length) return cache.list; // stale but usable
    return POPULAR.map((s) => ({ symbol: s, baseAsset: s.replace(/USDT$/, ''), quoteAsset: 'USDT' }));
  }
}

// USDT/stable pairs first, then shorter tickers, then alphabetical.
const rankQuote = (q) => (q === 'USDT' ? 0 : q === 'FDUSD' || q === 'USDC' ? 1 : 2);
const compare = (a, b) =>
  rankQuote(a.quoteAsset) - rankQuote(b.quoteAsset) ||
  a.symbol.length - b.symbol.length ||
  a.symbol.localeCompare(b.symbol);

export async function searchSymbols(q, limit = 20) {
  const query = String(q ?? '').trim().toUpperCase();
  const list = await loadSymbols();

  if (!query) {
    const byName = new Map(list.map((s) => [s.symbol, s]));
    const popular = POPULAR.map((sym) => byName.get(sym)).filter(Boolean);
    return (popular.length ? popular : list.slice().sort(compare)).slice(0, limit);
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
