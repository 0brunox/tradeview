import { Router } from 'express';
import { getCandles } from '../services/candles.js';
import { searchSymbols } from '../services/symbols.js';
import { isDbReady } from '../db/pool.js';
import { INTERVALS } from '../config.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, db: isDbReady() ? 'connected' : 'proxy', time: Date.now() });
});

// GET /api/symbols            → popular symbols
// GET /api/symbols?q=btc      → search matches (objects: {symbol, baseAsset, quoteAsset})
router.get('/symbols', async (req, res) => {
  const q = req.query.q ? String(req.query.q) : '';
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 50);
  try {
    const symbols = await searchSymbols(q, limit);
    res.json({ symbols });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/candles', async (req, res) => {
  const symbol = String(req.query.symbol ?? 'BTCUSDT').toUpperCase();
  const interval = String(req.query.interval ?? '1h');
  const limit = Math.min(Math.max(Number(req.query.limit ?? 500) || 500, 10), 1000);

  if (!INTERVALS.includes(interval)) {
    return res.status(400).json({ error: `invalid interval; use one of: ${INTERVALS.join(', ')}` });
  }

  try {
    const candles = await getCandles(symbol, interval, limit);
    res.json({ symbol, interval, candles });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
