/**
 * Estocástico KDJ → [{ time, k, d, j }] (warm-up pulado).
 *   RSV = (close - menor mínima) / (maior máxima - menor mínima) * 100
 *   K   = ((kSmooth-1) * K anterior + RSV) / kSmooth        (K inicial = 50)
 *   D   = ((dSmooth-1) * D anterior + K)   / dSmooth        (D inicial = 50)
 *   J   = 3K - 2D
 * Com kSmooth = dSmooth = 3 esta é a formulação clássica (1/3 · RSV + 2/3 · anterior).
 */
export function kdj(candles, period = 9, kSmooth = 3, dSmooth = 3) {
  const out = [];
  if (candles.length < period) return out;

  let k = 50;
  let d = 50;

  for (let i = period - 1; i < candles.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }

    // Faixa nula (candles idênticos): mantém o RSV anterior via K, evitando divisão por zero.
    const rsv = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;

    k = ((kSmooth - 1) * k + rsv) / kSmooth;
    d = ((dSmooth - 1) * d + k) / dSmooth;
    out.push({ time: candles[i].time, k, d, j: 3 * k - 2 * d });
  }
  return out;
}
