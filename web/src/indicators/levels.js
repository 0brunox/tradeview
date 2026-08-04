// Níveis de suporte e resistência derivados do preço — usados pela análise de IA.

/**
 * Pontos de pivô clássicos calculados sobre um candle de referência
 * (normalmente o último candle fechado do timeframe atual).
 *   P  = (H + L + C) / 3
 *   R1 = 2P - L        S1 = 2P - H
 *   R2 = P + (H - L)   S2 = P - (H - L)
 *   R3 = H + 2(P - L)  S3 = L - 2(H - P)
 * → { pivot, r1, r2, r3, s1, s2, s3 } ou null se não houver candle.
 */
export function pivotPoints(candle) {
  if (!candle) return null;
  const { high: h, low: l, close: c } = candle;
  const p = (h + l + c) / 3;
  const range = h - l;
  return {
    pivot: p,
    r1: 2 * p - l,
    r2: p + range,
    r3: h + 2 * (p - l),
    s1: 2 * p - h,
    s2: p - range,
    s3: l - 2 * (h - p),
  };
}

/**
 * Topos e fundos relevantes (swing highs/lows) dos últimos `lookback` candles.
 * Um swing high é um candle cuja máxima é a maior numa janela de ±`strength`
 * candles; swing low é o espelho disso.
 * → { highs: [{ time, price }], lows: [...] }, do mais recente para o mais antigo.
 */
export function swingLevels(candles, { lookback = 120, strength = 3, max = 5 } = {}) {
  const empty = { highs: [], lows: [] };
  if (!candles || candles.length < strength * 2 + 1) return empty;

  const slice = candles.slice(-lookback);
  const highs = [];
  const lows = [];

  for (let i = strength; i < slice.length - strength; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (slice[j].high >= slice[i].high) isHigh = false;
      if (slice[j].low <= slice[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ time: slice[i].time, price: slice[i].high });
    if (isLow) lows.push({ time: slice[i].time, price: slice[i].low });
  }

  return { highs: highs.slice(-max).reverse(), lows: lows.slice(-max).reverse() };
}

/** Maior máxima e menor mínima dos últimos `n` candles → { high, low }. */
export function rangeExtremes(candles, n) {
  const slice = candles.slice(-n);
  if (!slice.length) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return { high, low, bars: slice.length };
}
