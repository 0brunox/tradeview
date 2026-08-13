// Estrutura de mercado do ICT: swings, BOS e CHoCH/MSS.
//
// BOS  (Break of Structure)  → rompimento A FAVOR da direção vigente = continuação.
// CHoCH (Change of Character, também chamado MSS/Market Structure Shift)
//      → primeiro rompimento CONTRA a direção vigente = possível reversão.
//
// O ICT só considera o rompimento válido quando vem com *displacement*: um
// candle de range bem acima da média, sinal de que houve agressão e não apenas
// preço vazando pelo nível. Marcamos isso em `displacement` em vez de descartar
// o evento, para o gráfico poder diferenciar os dois visualmente.

import { avgRange } from './util.js';

/**
 * Topos e fundos de swing em ORDEM CRONOLÓGICA.
 * Um swing high é um candle cuja máxima é a maior numa janela de ±`strength`;
 * swing low é o espelho. Mesma definição de `swingLevels()` em ../levels.js,
 * mas aqui a ordem e o índice importam (a estrutura é lida em sequência).
 * → [{ index, time, price, kind: 'high' | 'low' }]
 */
export function swingPoints(candles, strength = 2) {
  const out = [];
  if (!candles || candles.length < strength * 2 + 1) return out;

  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, time: candles[i].time, price: candles[i].high, kind: 'high' });
    if (isLow) out.push({ index: i, time: candles[i].time, price: candles[i].low, kind: 'low' });
  }
  return out;
}

/**
 * Percorre os candles marcando cada rompimento de swing como BOS ou CHoCH.
 *
 * Um swing só passa a valer como referência depois de confirmado — ele precisa
 * dos `strength` candles à direita para existir. Por isso a varredura só libera
 * o swing no índice `swing.index + strength`, e não no próprio índice: sem isso
 * a estrutura enxergaria topos que, naquele momento, ainda não estavam formados.
 *
 * → {
 *     events: [{ index, time, price, type: 'BOS'|'CHoCH', dir: 'bull'|'bear', displacement }],
 *     bias: 'bull' | 'bear' | 'neutral',
 *     last: evento mais recente | null,
 *     refHigh / refLow: swings ainda não rompidos (os próximos alvos de estrutura)
 *   }
 */
export function marketStructure(candles, { strength = 2, displacementMult = 1.5, maxEvents = 12 } = {}) {
  const empty = { events: [], bias: 'neutral', last: null, refHigh: null, refLow: null };
  if (!candles || candles.length < strength * 2 + 2) return empty;

  const swings = swingPoints(candles, strength);
  if (!swings.length) return empty;

  const avg = avgRange(candles, 20);
  const events = [];
  let si = 0;
  let refHigh = null; // swing high vigente ainda não rompido
  let refLow = null;
  let bias = 'neutral';

  for (let j = 0; j < candles.length; j++) {
    // Libera os swings cuja janela de confirmação já fechou neste candle.
    while (si < swings.length && swings[si].index + strength <= j) {
      const s = swings[si];
      if (s.kind === 'high') refHigh = s;
      else refLow = s;
      si++;
    }

    const c = candles[j];
    const displaced = avg > 0 && c.high - c.low >= avg * displacementMult;

    if (refHigh && c.close > refHigh.price) {
      const type = bias === 'bear' ? 'CHoCH' : 'BOS';
      events.push({
        index: j, time: c.time, price: refHigh.price, type, dir: 'bull', displacement: displaced,
      });
      bias = 'bull';
      refHigh = null; // rompido — espera o próximo swing high se formar
    }

    if (refLow && c.close < refLow.price) {
      const type = bias === 'bull' ? 'CHoCH' : 'BOS';
      events.push({
        index: j, time: c.time, price: refLow.price, type, dir: 'bear', displacement: displaced,
      });
      bias = 'bear';
      refLow = null;
    }
  }

  return {
    events: events.slice(-maxEvents),
    bias,
    last: events.length ? events[events.length - 1] : null,
    refHigh,
    refLow,
  };
}
