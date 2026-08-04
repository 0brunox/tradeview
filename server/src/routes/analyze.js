// POST /api/analyze — equivalente local da function que roda na Vercel.
// A lógica (validação, prompt, streaming) vive em web/api/_analysis.js para os
// dois hosts se comportarem igual; aqui só construímos o cliente e o Express.
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { sanitizeSnapshot, streamAnalysis, friendlyError } from '../../../web/api/_analysis.js';
import { config } from '../config.js';

const router = Router();

router.post('/analyze', async (req, res) => {
  if (!config.anthropicApiKey) {
    return res.status(503).json({
      error: 'Análise de IA não configurada: defina ANTHROPIC_API_KEY no server/.env.',
    });
  }

  let snapshot;
  try {
    snapshot = sanitizeSnapshot(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    await streamAnalysis(client, snapshot, (text) => res.write(text));
    res.end();
  } catch (err) {
    const message = friendlyError(err);
    console.error('[analyze]', err?.status ?? '', err?.message ?? err);
    if (!res.headersSent) {
      res.status(502).json({ error: message });
    } else {
      res.write(`\n\n> ⚠️ Erro durante a análise: ${message}`);
      res.end();
    }
  }
});

export default router;
