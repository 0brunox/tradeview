/**
 * Bollinger Bands → { upper, middle, lower }, each [{ time, value }].
 *   middle = SMA(period)
 *   upper/lower = middle ± mult * stddev (population stddev over the window)
 */
export function bollinger(candles, period = 20, mult = 2) {
  const upper = [];
  const middle = [];
  const lower = [];

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;

    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j].close - mean;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    const time = candles[i].time;

    middle.push({ time, value: mean });
    upper.push({ time, value: mean + mult * sd });
    lower.push({ time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}
