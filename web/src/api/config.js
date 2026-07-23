// Data-source selection.
//   'backend' (default) → talk to the Node backend (local dev, self-hosted)
//   'binance'           → talk directly to Binance (static deploy, e.g. Vercel)
export const DATA_SOURCE = (import.meta.env.VITE_DATA_SOURCE ?? 'backend').toLowerCase();
export const IS_DIRECT = DATA_SOURCE === 'binance';

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/ws';

export const BINANCE_REST = import.meta.env.VITE_BINANCE_REST ?? 'https://api.binance.com';
export const BINANCE_WS = import.meta.env.VITE_BINANCE_WS ?? 'wss://stream.binance.com:9443';
