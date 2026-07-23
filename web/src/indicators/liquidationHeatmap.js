// Estimated liquidation heatmap from Open Interest — the Coinglass *method*,
// reproduced with free data. This is a MODEL, not real liquidation data:
// it projects where leveraged positions would be liquidated and how much
// notional clusters at each price. Use it as a map of "magnetic" zones.

// Leverage buckets with a rough retail weighting (higher leverage is common
// but each tier carries different notional). Longs liquidate below entry,
// shorts above, by ~1/leverage minus maintenance margin.
const DEFAULT_LEVERAGES = [
  { lev: 100, w: 0.30 },
  { lev: 50, w: 0.30 },
  { lev: 25, w: 0.25 },
  { lev: 10, w: 0.15 },
];
const MAINT_MARGIN = 0.005; // ~0.5% maintenance margin approximation

/**
 * @param oiSeries [{ time, oiUsd, oiBase }] recent open interest (ascending)
 * @returns { cells:[{priceLow,priceHigh,intensity}], priceLo, priceHi } | null
 */
export function liquidationHeatmap(oiSeries, opts = {}) {
  const leverages = opts.leverages || DEFAULT_LEVERAGES;
  const bins = opts.bins || 140;
  if (!Array.isArray(oiSeries) || oiSeries.length < 2) return null;

  // New notional opened at each step, priced by oiUsd/oiBase (the mark price).
  const opened = [];
  for (let i = 1; i < oiSeries.length; i += 1) {
    const price = oiSeries[i].oiUsd / oiSeries[i].oiBase;
    const dOi = oiSeries[i].oiUsd - oiSeries[i - 1].oiUsd;
    if (Number.isFinite(price) && price > 0 && dOi > 0) opened.push({ price, notional: dOi });
  }
  if (opened.length === 0) return null;

  // Project long/short liquidation levels for every leverage bucket.
  const levels = [];
  for (const e of opened) {
    for (const { lev, w } of leverages) {
      const frac = 1 / lev - MAINT_MARGIN; // distance to liquidation
      if (frac <= 0) continue;
      const weight = e.notional * w * 0.5; // split evenly long/short
      levels.push({ price: e.price * (1 - frac), weight }); // longs liq below
      levels.push({ price: e.price * (1 + frac), weight }); // shorts liq above
    }
  }
  if (levels.length === 0) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const l of levels) {
    if (l.price < lo) lo = l.price;
    if (l.price > hi) hi = l.price;
  }
  if (!(hi > lo)) return null;

  const step = (hi - lo) / bins;
  const buckets = new Array(bins).fill(0);
  for (const l of levels) {
    let idx = Math.floor((l.price - lo) / step);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    buckets[idx] += l.weight;
  }

  let max = 0;
  for (const b of buckets) if (b > max) max = b;
  if (max <= 0) return null;

  const cells = [];
  for (let i = 0; i < bins; i += 1) {
    if (buckets[i] <= 0) continue;
    cells.push({
      priceLow: lo + i * step,
      priceHigh: lo + (i + 1) * step,
      intensity: buckets[i] / max, // 0..1
    });
  }
  return { cells, priceLo: lo, priceHi: hi };
}
