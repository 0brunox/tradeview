/**
 * EMA over a raw numeric series. Seeded with the SMA of the first `period`
 * values (the conventional seeding). Returns an array aligned to `values`,
 * with `undefined` during the warm-up.
 */
export function emaValues(values, period) {
  const out = new Array(values.length).fill(undefined);
  const k = 2 / (period + 1);
  let sum = 0;
  let prev;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      sum += values[i];
      if (i === period - 1) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** EMA of candle closes → [{ time, value }] (warm-up skipped). */
export function ema(candles, period) {
  const vals = emaValues(candles.map((c) => c.close), period);
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    if (vals[i] !== undefined) out.push({ time: candles[i].time, value: vals[i] });
  }
  return out;
}
