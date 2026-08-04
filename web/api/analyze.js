// POST /api/analyze — Vercel Serverless Function.
// Recebe o snapshot de mercado do browser e devolve o relatório da IA em
// streaming (text/plain). A ANTHROPIC_API_KEY fica só aqui, nunca no cliente.
import Anthropic from '@anthropic-ai/sdk';
import { sanitizeSnapshot, streamAnalysis, friendlyError } from './_analysis.js';

// Streaming mantém a conexão viva; 60s é o teto do plano Hobby.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'método não permitido' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Análise de IA não configurada: defina ANTHROPIC_API_KEY no projeto.',
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
  // Desliga o buffering de proxies para o texto chegar em pedaços.
  res.setHeader('X-Accel-Buffering', 'no');

  const client = new Anthropic();

  try {
    await streamAnalysis(client, snapshot, (text) => res.write(text));
    res.end();
  } catch (err) {
    const message = friendlyError(err);
    console.error('[analyze]', err?.status ?? '', err?.message ?? err);
    // Se nada foi escrito ainda dá para devolver um status de erro de verdade;
    // depois do primeiro byte só resta anexar o aviso ao corpo.
    if (!res.headersSent) {
      res.status(502).json({ error: message });
    } else {
      res.write(`\n\n> ⚠️ Erro durante a análise: ${message}`);
      res.end();
    }
  }
}
