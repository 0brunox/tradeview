import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.js';
import { normalizeWsKline } from '../providers/binance.js';
import { upsertCandle } from '../services/candles.js';

/**
 * Real-time hub.
 *
 * Clients connect to /ws and send { type:'subscribe', symbol, interval }.
 * For each distinct symbol|interval we open ONE upstream Binance kline stream
 * and fan its ticks out to every subscribed client. The upstream is closed when
 * its last client leaves, and transparently reconnected if Binance drops it.
 */
export function attachWsHub(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // key -> { upstream, clients:Set, symbol, interval, closing }
  const streams = new Map();
  const keyOf = (symbol, interval) => `${symbol.toLowerCase()}@${interval}`;

  function connectUpstream(entry, key) {
    const url = `${config.binanceWs}/ws/${entry.symbol.toLowerCase()}@kline_${entry.interval}`;
    const upstream = new WebSocket(url);
    entry.upstream = upstream;

    upstream.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg.k) return;

      const candle = normalizeWsKline(msg.k);
      const payload = JSON.stringify({
        type: 'candle', symbol: entry.symbol, interval: entry.interval, candle,
      });
      for (const client of entry.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      }
      if (candle.closed) {
        upsertCandle(entry.symbol, entry.interval, candle).catch(() => {});
      }
    });

    upstream.on('close', () => {
      if (entry.closing || entry.clients.size === 0) {
        streams.delete(key);
        return;
      }
      // Binance closes streams periodically — reconnect while clients remain.
      setTimeout(() => {
        if (streams.get(key) === entry && !entry.closing) connectUpstream(entry, key);
      }, 1000);
    });

    upstream.on('error', (err) => console.warn(`[ws] upstream ${key}: ${err.message}`));
  }

  function subscribe(client, symbol, interval) {
    unsubscribe(client);
    const key = keyOf(symbol, interval);
    let entry = streams.get(key);
    if (!entry) {
      entry = { upstream: null, clients: new Set(), symbol, interval, closing: false };
      streams.set(key, entry);
      connectUpstream(entry, key);
    }
    entry.clients.add(client);
    client.streamKey = key;
    client.send(JSON.stringify({ type: 'subscribed', symbol, interval }));
  }

  function unsubscribe(client) {
    const key = client.streamKey;
    if (!key) return;
    client.streamKey = null;
    const entry = streams.get(key);
    if (!entry) return;
    entry.clients.delete(client);
    if (entry.clients.size === 0) {
      entry.closing = true;
      try { entry.upstream?.close(); } catch { /* ignore */ }
      streams.delete(key);
    }
  }

  wss.on('connection', (client) => {
    client.streamKey = null;
    client.isAlive = true;
    client.on('pong', () => { client.isAlive = true; });

    client.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'subscribe' && msg.symbol && msg.interval) {
        subscribe(client, String(msg.symbol).toUpperCase(), String(msg.interval));
      } else if (msg.type === 'unsubscribe') {
        unsubscribe(client);
      }
    });

    client.on('close', () => unsubscribe(client));
    client.on('error', () => unsubscribe(client));
  });

  // Drop dead connections.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { client.terminate(); continue; }
      client.isAlive = false;
      try { client.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  console.log('[ws] hub attached at /ws');
  return wss;
}
