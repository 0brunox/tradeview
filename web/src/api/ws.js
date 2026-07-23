import { WS_URL, IS_DIRECT } from './config.js';
import { BinanceLiveClient } from './binance.js';

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

/** Returns the right live client for the configured data source. */
export function createLiveClient(opts) {
  return IS_DIRECT ? new BinanceLiveClient(opts) : new LiveClient(opts);
}
