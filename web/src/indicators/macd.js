import { emaValues } from './ema.js';

const UP = '#26a69a';
const DOWN = '#ef5350';

/**
 * MACD → { macdLine, signalLine, histogram }, each [{ time, value }]
 * (histogram points also carry a `color`).
 *   macd   = EMA(fast) - EMA(slow)
 *   signal = EMA(signal) of the macd line
 *   hist   = macd - signal
 */
export function macd(candles, fast = 12, slow = 26, signal = 9) {
  const closes = candles.map((c) => c.close);
  const emaFast = emaValues(closes, fast);
  const emaSlow = emaValues(closes, slow);

  // MACD line, keeping index alignment with candles.
  const macdByIndex = new Array(candles.length).fill(undefined);
  const macdLine = [];
  for (let i = 0; i < candles.length; i++) {
    if (emaFast[i] !== undefined && emaSlow[i] !== undefined) {
      const v = emaFast[i] - emaSlow[i];
      macdByIndex[i] = v;
      macdLine.push({ time: candles[i].time, value: v });
    }
  }

  // Signal = EMA of the (compact) macd values, then re-align to candle times.
  const compact = macdByIndex.filter((v) => v !== undefined);
  const sig = emaValues(compact, signal);

  const signalLine = [];
  const histogram = [];
  let j = 0;
  for (let i = 0; i < candles.length; i++) {
    if (macdByIndex[i] === undefined) continue;
    const s = sig[j];
    if (s !== undefined) {
      const h = macdByIndex[i] - s;
      signalLine.push({ time: candles[i].time, value: s });
      histogram.push({ time: candles[i].time, value: h, color: h >= 0 ? UP : DOWN });
    }
    j++;
  }
  return { macdLine, signalLine, histogram };
}
