// Direct-to-Bybit spot data source. Bybit sends permissive CORS headers, so the
// browser can call it directly in any data-source mode (no backend proxy needed).
// Docs: https://bybit-exchange.github.io/docs/v5/market/kline

const BYBIT_REST = 'https://api.bybit.com';
const BYBIT_WS = 'wss://stream.bybit.com/v5/public/spot';

// App's canonical interval → Bybit v5 kline code.
const BYBIT_INTERVAL = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
  '1d': 'D', '1w': 'W', '1M': 'M',
};

export async function fetchCandlesBybit(symbol, interval, limit = 500) {
  const iv = BYBIT_INTERVAL[interval];
  if (!iv) throw new Error(`Bybit: intervalo não suportado (${interval})`);
  const url =
    `${BYBIT_REST}/v5/market/kline?category=spot` +
    `&symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit ${res.status}`);
  const j = await res.json();
  if (j.retCode !== 0) throw new Error(`Bybit: ${j.retMsg}`);
  // list is newest-first: [startMs, open, high, low, close, volume, turnover]
  return (j.result?.list ?? [])
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      openTime: Number(k[0]),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
    }))
    .reverse(); // ascending by time for the chart
}

// 24h ticker (price + change%) for a set of symbols. Bybit's endpoint has no
// multi-symbol filter, so we pull all spot tickers once and pick the ones we want.
export async function fetchTickersBybit(symbols) {
  if (!symbols || symbols.length === 0) return [];
  try {
    const res = await fetch(`${BYBIT_REST}/v5/market/tickers?category=spot`);
    if (!res.ok) return [];
    const j = await res.json();
    const want = new Set(symbols);
    return (j.result?.list ?? [])
      .filter((r) => want.has(r.symbol))
      .map((r) => ({
        symbol: r.symbol,
        price: +r.lastPrice,
        changePct: +r.price24hPcnt * 100, // Bybit returns a ratio (e.g. -0.0121)
      }));
  } catch {
    return [];
  }
}

// --- symbol search over the spot instrument list (cached 12h) ---
const LS_KEY = 'tradeview:bybit-symbols';
const TTL = 12 * 60 * 60 * 1000;
let cache = null;

async function loadBybitSymbols() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const { at, list } = JSON.parse(raw);
      if (Array.isArray(list) && list.length && Date.now() - at < TTL) {
        cache = list;
        return cache;
      }
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(`${BYBIT_REST}/v5/market/instruments-info?category=spot&limit=1000`);
    const j = await res.json();
    cache = (j.result?.list ?? [])
      .filter((s) => s.status === 'Trading')
      .map((s) => ({ symbol: s.symbol, baseAsset: s.baseCoin, quoteAsset: s.quoteCoin }));
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ at: Date.now(), list: cache }));
    } catch { /* quota — fine */ }
  } catch {
    cache = [];
  }
  return cache;
}

const cmp = (a, b) => a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol);

export async function searchSymbolsBybit(q = '', limit = 12) {
  const query = String(q).trim().toUpperCase();
  if (!query) return [];
  const list = await loadBybitSymbols();

  const starts = [];
  const contains = [];
  for (const s of list) {
    if (s.symbol.startsWith(query) || s.baseAsset === query) starts.push(s);
    else if (s.symbol.includes(query)) contains.push(s);
  }
  starts.sort(cmp);
  contains.sort(cmp);
  return [...starts, ...contains].slice(0, limit).map((s) => ({
    symbol: `BYBIT:${s.symbol}`,
    baseAsset: s.baseAsset,
    quoteAsset: s.quoteAsset,
    source: 'bybit',
  }));
}

// --- live klines straight from the Bybit spot stream ---
export class BybitLiveClient {
  constructor({ onCandle, onStatus } = {}) {
    this.onCandle = onCandle ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.sub = null; // { symbol, interval }
    this.ws = null;
    this.pingTimer = null;
    this.closedByUser = false;
  }

  subscribe(symbol, interval) {
    this.sub = { symbol, interval };
    this.open();
  }

  open() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    if (!this.sub || this.closedByUser) return;
    const { symbol, interval } = this.sub;
    const iv = BYBIT_INTERVAL[interval];
    if (!iv) return;
    const topic = `kline.${iv}.${symbol}`;

    this.onStatus('connecting');
    const ws = new WebSocket(BYBIT_WS);
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus('open');
      ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
      // Bybit drops idle sockets — keep it alive with a ping.
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
      }, 20000);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (typeof m.topic !== 'string' || !m.topic.startsWith('kline.') || !Array.isArray(m.data)) return;
      const k = m.data[m.data.length - 1];
      if (!k) return;
      this.onCandle(
        {
          time: Math.floor(Number(k.start) / 1000),
          openTime: Number(k.start),
          open: +k.open,
          high: +k.high,
          low: +k.low,
          close: +k.close,
          volume: +k.volume,
          closed: !!k.confirm,
        },
        symbol,
        interval,
      );
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.onStatus('closed');
      if (!this.closedByUser && this.sub) setTimeout(() => this.open(), 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
