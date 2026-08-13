// Order Blocks (OB) e Breaker Blocks.
//
// Order Block é o último candle de cor OPOSTA antes da perna que rompe a
// estrutura — a ideia do ICT é que ali ficou a ordem institucional que
// originou o movimento, e o preço tende a voltar para "mitigar" essa zona.
//   • rompimento de alta  → último candle de BAIXA antes da perna = OB bullish
//   • rompimento de baixa → último candle de ALTA  antes da perna = OB bearish
//
// Quando o preço FECHA do outro lado do bloco, ele falhou como suporte/
// resistência e vira um *breaker*: passa a valer com a polaridade invertida.

import { isDown, isUp } from './util.js';

/**
 * Deriva os blocos a partir dos eventos de estrutura (`marketStructure().events`).
 *
 * @param lookback quantos candles voltar procurando o candle de origem. A perna
 *   de displacement costuma ter poucos candles da mesma cor; se nada aparecer
 *   nessa janela, o evento não gera bloco em vez de ancorar num candle
 *   arbitrário lá atrás.
 * → [{ index, time, top, bottom, bodyTop, bodyBottom, dir: 'bull'|'bear',
 *      kind: 'ob'|'breaker', state: 'fresh'|'mitigated'|'broken', mitigatedTime }]
 */
export function orderBlocks(candles, events, { lookback = 15, maxBlocks = 8 } = {}) {
  const out = [];
  if (!candles || !candles.length || !events || !events.length) return out;

  const seen = new Set(); // eventos distintos podem cair no mesmo candle de origem

  for (const ev of events) {
    const wantDown = ev.dir === 'bull';
    let originIndex = -1;

    for (let i = ev.index - 1; i >= 0 && i >= ev.index - lookback; i--) {
      if (wantDown ? isDown(candles[i]) : isUp(candles[i])) {
        originIndex = i;
        break;
      }
    }
    if (originIndex < 0 || seen.has(originIndex)) continue;
    seen.add(originIndex);

    const c = candles[originIndex];
    const block = {
      index: originIndex,
      time: c.time,
      top: c.high,
      bottom: c.low,
      bodyTop: Math.max(c.open, c.close),
      bodyBottom: Math.min(c.open, c.close),
      dir: ev.dir,
      kind: 'ob',
      state: 'fresh',
      mitigatedTime: null,
    };

    // Estado do bloco daqui para frente: tocado (mitigado) ou perdido (breaker).
    for (let i = ev.index + 1; i < candles.length; i++) {
      const k = candles[i];
      if (block.dir === 'bull') {
        if (k.close < block.bottom) {
          block.state = 'broken';
          block.kind = 'breaker';
          block.dir = 'bear'; // breaker inverte a polaridade
          block.mitigatedTime = k.time;
          break;
        }
        if (k.low <= block.top && block.state === 'fresh') {
          block.state = 'mitigated';
          block.mitigatedTime = k.time;
        }
      } else {
        if (k.close > block.top) {
          block.state = 'broken';
          block.kind = 'breaker';
          block.dir = 'bull';
          block.mitigatedTime = k.time;
          break;
        }
        if (k.high >= block.bottom && block.state === 'fresh') {
          block.state = 'mitigated';
          block.mitigatedTime = k.time;
        }
      }
    }

    out.push(block);
  }

  out.sort((a, b) => a.index - b.index);
  return out.slice(-maxBlocks);
}

/** Blocos que ainda não foram perdidos — os que seguem valendo como zona. */
export function activeBlocks(blocks) {
  return blocks.filter((b) => b.state !== 'broken');
}
