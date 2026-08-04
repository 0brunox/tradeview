import 'dotenv/config';

function stripSlash(url) {
  return url.replace(/\/+$/, '');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  binanceRest: stripSlash(process.env.BINANCE_REST ?? 'https://api.binance.com'),
  binanceWs: stripSlash(process.env.BINANCE_WS ?? 'wss://stream.binance.com:9443'),
  databaseUrl: process.env.DATABASE_URL ?? '',
  dbEnabled: (process.env.DB_ENABLED ?? 'true').toLowerCase() !== 'false',
  // Vazio = rota /api/analyze responde 503 e o botão de IA fica desabilitado.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
};

// Timeframes we accept and forward to Binance (Binance interval strings).
// Includes the higher frames used by the multi-timeframe RSI panel (12h, 1w, 1M).
export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '12h', '1d', '1w', '1M'];
