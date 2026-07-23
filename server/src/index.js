import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config } from './config.js';
import { initDb } from './db/pool.js';
import apiRouter from './routes/api.js';
import { attachWsHub } from './ws/hub.js';

async function main() {
  await initDb();

  const app = express();
  app.use(cors({ origin: config.webOrigin }));
  app.use(express.json());
  app.use('/api', apiRouter);
  app.get('/', (_req, res) => res.json({ name: 'tradeview-server', ws: '/ws', api: '/api' }));

  const server = createServer(app);
  attachWsHub(server);

  server.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
    console.log(`[server] CORS origin: ${config.webOrigin}`);
    console.log(`[server] Binance REST: ${config.binanceRest}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
