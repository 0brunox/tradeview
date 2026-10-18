// Fluxo comprador/vendedor do mercado SPOT, direto da Binance (CORS liberado,
// mesma estratégia do derivatives.js — não passa pelo backend).
//
// O kline da Binance traz, além do volume total, o "taker buy base asset
// volume": quanto desse volume foi executado por quem comprou a mercado. O
// resto foi vendido a mercado. A diferença é o *delta* de volume do candle —
// a matéria-prima do CVD (Cumulative Volume Delta).
import { BINANCE_REST } from './config.js';
import { splitSymbol } from './binance.js';

// O mesmo ativo negocia em vários mercados stable na Binance. Somar os três
// aproxima o "aggregated spot" das plataformas de fluxo, em vez de olhar só o par
// aberto no gráfico (em BTC, por exemplo, o FDUSD costuma ter volume comparável
// ao do USDT).
const STABLE_QUOTES = ['USDT', 'FDUSD', 'USDC'];

// Mercados spot a somar para um símbolo. Pares não-stable (ETHBTC, SOLBNB…)
// não têm equivalente, então só eles mesmos entram.
function marketsFor(symbol) {
  const { baseAsset, quoteAsset } = splitSymbol(symbol);
  if (!STABLE_QUOTES.includes(quoteAsset)) return [symbol];
  return [symbol, ...STABLE_QUOTES.filter((q) => q !== quoteAsset).map((q) => baseAsset + q)];
}

// Delta por candle de um mercado, em moedas do ativo base.
// → [{ time (ms), buy, sell, delta }] ou null quando o mercado não existe.
async function fetchMarketDelta(market, interval, limit) {
  const url =
    `${BINANCE_REST}/api/v3/klines` +
    `?symbol=${encodeURIComponent(market)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return null; // 400 = par inexistente; é só ficar de fora do agregado
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  return rows.map((k) => {
    const volume = +k[5];
    const buy = +k[9]; // taker buy base asset volume
    const sell = volume - buy;
    return { time: k[0], buy, sell, delta: buy - sell };
  });
}

/**
 * Delta de volume spot agregado entre os mercados stable do ativo.
 * → { rows: [{ time (ms), buy, sell, delta }] em ordem crescente, markets: [...] }
 */
export async function fetchSpotDelta(symbol, interval, limit = 800) {
  const markets = marketsFor(symbol);
  const capped = Math.min(Math.max(limit, 1), 1000);
  const results = await Promise.all(
    markets.map((m) => fetchMarketDelta(m, interval, capped).catch(() => null)),
  );

  const used = [];
  const byTime = new Map();
  results.forEach((rows, i) => {
    if (!rows || rows.length === 0) return;
    used.push(markets[i]);
    for (const r of rows) {
      const cur = byTime.get(r.time);
      if (cur) {
        cur.buy += r.buy;
        cur.sell += r.sell;
        cur.delta += r.delta;
      } else {
        byTime.set(r.time, { ...r });
      }
    }
  });

  return {
    rows: [...byTime.values()].sort((a, b) => a.time - b.time),
    markets: used,
  };
}
