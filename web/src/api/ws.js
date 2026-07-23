import { WS_URL, IS_DIRECT } from './config.js';
import { BinanceLiveClient } from './binance.js';
import { BybitLiveClient } from './bybit.js';
import { parseSymbol } from './source.js';

/**
 * Backend live-candle client (auto-reconnect). Talks to our Node /ws hub and
 * re-subscribes to the last requested (symbol, interval) whenever it reopens.
 */
export class LiveClient {
  constructor({ onCandle, onStatus } = {}) {
    this.onCandle = onCandle ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.sub = null;
    this.ws = null;
    this.closedByUser = false;
    this.connect();
  }

  connect() {
    this.onStatus('connecting');
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.onStatus('open');
      if (this.sub) this.send({ type: 'subscribe', ...this.sub });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'candle') this.onCandle(msg.candle, msg.symbol, msg.interval);
    };
    ws.onclose = () => {
      this.onStatus('closed');
      if (!this.closedByUser) setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  subscribe(symbol, interval) {
    this.sub = { symbol, interval };
    this.send({ type: 'subscribe', symbol, interval });
  }

  close() {
    this.closedByUser = true;
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

/**
 * Routes live subscriptions to the right exchange by symbol prefix.
 * Binance (no prefix) goes through the configured source (backend hub or direct);
 * Bybit (BYBIT:) always streams straight from Bybit and re-emits the full symbol.
 */
class RouterLiveClient {
  constructor(opts = {}) {
    this.onCandle = opts.onCandle ?? (() => {});
    this.onStatus = opts.onStatus ?? (() => {});
    this.active = 'binance';
    const binanceOpts = { onCandle: this.onCandle, onStatus: (s) => this.report('binance', s) };
    this.binance = IS_DIRECT ? new BinanceLiveClient(binanceOpts) : new LiveClient(binanceOpts);
    this.bybit = new BybitLiveClient({
      onStatus: (s) => this.report('bybit', s),
      onCandle: (candle, sym, iv) => this.onCandle(candle, `BYBIT:${sym}`, iv),
    });
  }

  // Only the active source drives the UI status; the idle client stays quiet.
  report(source, status) {
    if (source === this.active) this.onStatus(status);
  }

  subscribe(fullSymbol, interval) {
    const { source, symbol } = parseSymbol(fullSymbol);
    this.active = source === 'bybit' ? 'bybit' : 'binance';
    if (source === 'bybit') this.bybit.subscribe(symbol, interval);
    else this.binance.subscribe(symbol, interval);
  }

  close() {
    try { this.binance.close(); } catch { /* ignore */ }
    try { this.bybit.close(); } catch { /* ignore */ }
  }
}

/** Live client that routes across data sources by symbol prefix. */
export function createLiveClient(opts) {
  return new RouterLiveClient(opts);
}
