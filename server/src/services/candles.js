import { fetchKlines } from '../providers/binance.js';
import { getPool } from '../db/pool.js';

/**
 * Get candles for (symbol, interval).
 * Primary source is Binance (freshest). Successful fetches are written through
 * to Postgres (best-effort). If Binance is unreachable, we fall back to the DB.
 */
export async function getCandles(symbol, interval, limit = 500) {
  try {
    const candles = await fetchKlines(symbol, interval, limit);
    // fire-and-forget cache write
    upsertCandles(symbol, interval, candles).catch((e) =>
      console.warn(`[candles] cache write failed: ${e.message}`),
    );
    return candles;
  } catch (err) {
    console.warn(`[candles] Binance failed (${err.message}) — trying DB cache`);
    const cached = await readCandles(symbol, interval, limit);
    if (cached.length) return cached;
    throw err;
  }
}

/** Bulk upsert. No-op when the DB is in proxy mode. */
export async function upsertCandles(symbol, interval, candles) {
  const pool = getPool();
  if (!pool || candles.length === 0) return;

  const tuples = [];
  const values = [];
  candles.forEach((c, i) => {
    const b = i * 8;
    tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
    values.push(symbol, interval, c.openTime, c.open, c.high, c.low, c.close, c.volume);
  });

  const sql =
    `INSERT INTO candles (symbol, interval, open_time, open, high, low, close, volume) ` +
    `VALUES ${tuples.join(',')} ` +
    `ON CONFLICT (symbol, interval, open_time) DO UPDATE SET ` +
    `open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, ` +
    `close = EXCLUDED.close, volume = EXCLUDED.volume`;

  await pool.query(sql, values);
}

export function upsertCandle(symbol, interval, candle) {
  return upsertCandles(symbol, interval, [candle]);
}

async function readCandles(symbol, interval, limit) {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT open_time, open, high, low, close, volume
       FROM candles
      WHERE symbol = $1 AND interval = $2
      ORDER BY open_time DESC
      LIMIT $3`,
    [symbol, interval, limit],
  );
  return rows
    .map((r) => ({
      time: Math.floor(Number(r.open_time) / 1000),
      openTime: Number(r.open_time),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }))
    .reverse(); // ascending by time for the chart
}
