import { AI_BASE } from './config.js';

/**
 * Envia o snapshot para /api/analyze e entrega o relatório em streaming.
 * `onChunk` recebe cada pedaço de texto assim que chega, para o painel ir
 * preenchendo em vez de esperar o relatório inteiro.
 * Lança Error com a mensagem do servidor quando a requisição falha.
 */
export async function requestAnalysis(snapshot, { onChunk, signal } = {}) {
  const res = await fetch(`${AI_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Falha na análise (HTTP ${res.status})`);
  }

  // Sem body legível (navegador antigo): cai para o texto completo de uma vez.
  if (!res.body?.getReader) {
    const text = await res.text();
    onChunk?.(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onChunk?.(chunk);
  }

  const tailText = decoder.decode();
  if (tailText) {
    full += tailText;
    onChunk?.(tailText);
  }
  return full;
}
