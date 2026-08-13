// Fair Value Gaps (FVG) — o desequilíbrio de 3 candles do ICT.
//
// Bullish FVG / BISI (Buyside Imbalance, Sellside Inefficiency):
//   a máxima do 1º candle fica ABAIXO da mínima do 3º → há um vão de preço que
//   o mercado atravessou sem negociar dos dois lados.
// Bearish FVG / SIBI (Sellside Imbalance, Buyside Inefficiency): o espelho.
//
// O nível que o ICT mais usa dentro do gap é a *consequent encroachment* (CE),
// o ponto médio — é onde ele espera a reação quando o preço volta a preencher.

import { avgRange } from './util.js';

/**
 * Varre os candles uma única vez, abrindo gaps novos e atualizando o estado dos
 * que ainda não foram preenchidos. Um gap formado pelos candles (i−2, i−1, i) só
 * é conhecido em `i`, e só pode ser mitigado por candles posteriores a `i` — o
 * que deixa a varredura linear em vez de quadrática.
 *
 * @param minSizeMult tamanho mínimo do gap como fração do range médio. Filtra os
 *   vãos de 1 tick que aparecem às centenas em timeframes baixos e não têm
 *   nenhum significado operacional.
 * → [{ index, time, top, bottom, ce, dir: 'bull'|'bear',
 *      state: 'open'|'partial'|'filled', filledTime }]  (ordem cronológica)
 */
export function fairValueGaps(candles, { minSizeMult = 0.1, maxAge = 300, maxGaps = 24 } = {}) {
  const out = [];
  if (!candles || candles.length < 3) return out;

  const avg = avgRange(candles, 20);
  const minSize = avg * minSizeMult;
  const active = [];

  for (let i = 2; i < candles.length; i++) {
    const c = candles[i];

    // Atualiza os gaps ainda abertos com o candle atual.
    for (let k = active.length - 1; k >= 0; k--) {
      const g = active[k];
      if (g.dir === 'bull') {
        if (c.low <= g.bottom) {
          g.state = 'filled';
          g.filledTime = c.time;
          active.splice(k, 1);
        } else if (c.low < g.top) {
          g.state = 'partial';
        }
      } else if (c.high >= g.top) {
        g.state = 'filled';
        g.filledTime = c.time;
        active.splice(k, 1);
      } else if (c.high > g.bottom) {
        g.state = 'partial';
      }
    }

    // Novo gap entre o candle i−2 e o candle i.
    const a = candles[i - 2];
    let gap = null;
    if (a.high < c.low && c.low - a.high >= minSize) {
      gap = { top: c.low, bottom: a.high, dir: 'bull' };
    } else if (a.low > c.high && a.low - c.high >= minSize) {
      gap = { top: a.low, bottom: c.high, dir: 'bear' };
    }
    if (gap) {
      // Ancorado no candle do meio: é o de displacement, o que abriu o vão.
      const g = {
        index: i - 1,
        time: candles[i - 1].time,
        top: gap.top,
        bottom: gap.bottom,
        ce: (gap.top + gap.bottom) / 2,
        dir: gap.dir,
        state: 'open',
        filledTime: null,
      };
      out.push(g);
      active.push(g);
    }
  }

  // Só interessa o passado recente — gap de 600 candles atrás não é contexto útil.
  const minIndex = candles.length - maxAge;
  return out.filter((g) => g.index >= minIndex).slice(-maxGaps);
}

/** Só os gaps que ainda não foram totalmente preenchidos. */
export function openGaps(gaps) {
  return gaps.filter((g) => g.state !== 'filled');
}
