// Ponto de entrada único da leitura ICT.
//
// O gráfico, o painel de viés e o snapshot da IA consomem TODOS este mesmo
// objeto. Se cada um calculasse por conta própria, o painel acabaria dizendo
// uma coisa e o desenho mostrando outra.

import { marketStructure, swingPoints } from './structure.js';
import { fairValueGaps, openGaps } from './fvg.js';
import { orderBlocks, activeBlocks } from './orderBlocks.js';
import { liquidityPools, nearestTargets } from './liquidity.js';
import { dealingRange } from './range.js';
import { killzones, powerOfThree, activeKillzone, supportsSessions } from './sessions.js';

export { supportsSessions } from './sessions.js';

// A parte pesada é memorizada por candle FECHADO. Numa vela em formação o
// preço muda a cada tick, mas estrutura, gaps e blocos não deveriam mudar
// junto: o ICT confirma tudo isso no fechamento. Então o cálculo roda sobre os
// candles fechados e só o que depende do preço atual é refeito a cada tick.
let cache = { key: null, value: null };

function computeClosed(closed, interval) {
  const structure = marketStructure(closed);
  const fvgs = fairValueGaps(closed);
  const blocks = orderBlocks(closed, structure.events);
  const pools = liquidityPools(closed);
  const range = dealingRange(closed);
  const sessions = supportsSessions(interval)
    ? { bands: killzones(closed), po3: powerOfThree(closed) }
    : { bands: [], po3: null };

  return { structure, fvgs, blocks, pools, range, sessions, swings: swingPoints(closed) };
}

/**
 * Retrato ICT completo do ativo/timeframe.
 *
 * @param candles candles do gráfico — o ÚLTIMO é a vela em formação e fica de
 *   fora dos cálculos estruturais de propósito (ver comentário do cache).
 * @param symbol precisa entrar na chave do cache: dois ativos no mesmo
 *   timeframe têm exatamente a mesma contagem e os mesmos horários de candle,
 *   então sem o símbolo a troca de par serviria a leitura do par anterior.
 * → objeto com estrutura, gaps, blocos, liquidez, range e sessões — ou null
 *   quando não há histórico suficiente.
 */
export function buildIctContext(candles, { symbol = '', interval = '1h' } = {}) {
  if (!candles || candles.length < 20) return null;

  const closed = candles.slice(0, -1);
  const live = candles[candles.length - 1];
  const price = live.close;

  const key = `${symbol}|${interval}|${closed.length}|${closed[closed.length - 1]?.time ?? 0}`;
  if (cache.key !== key) cache = { key, value: computeClosed(closed, interval) };
  const base = cache.value;

  // --- camada viva: tudo que se move junto com o preço -----------------------
  const pools = base.pools.map((p) => ({
    ...p,
    distancePct: price ? ((p.price - price) / price) * 100 : null,
  }));

  let range = base.range;
  if (range) {
    const pricePct = (price - range.low) / range.size;
    range = {
      ...range,
      pricePct,
      zone: pricePct > 0.52 ? 'premium' : pricePct < 0.48 ? 'discount' : 'equilibrium',
      inOte: price >= range.ote.bottom && price <= range.ote.top,
    };
  }

  const fvgs = openGaps(base.fvgs);
  const blocks = activeBlocks(base.blocks);

  return {
    price,
    interval,
    structure: base.structure,
    swings: base.swings,
    fvgs,
    allFvgs: base.fvgs,
    blocks,
    allBlocks: base.blocks,
    pools,
    targets: nearestTargets(pools, price),
    range,
    killzoneBands: base.sessions.bands,
    activeKillzone: supportsSessions(interval) ? activeKillzone() : null,
    po3: base.sessions.po3,
    // Zona mais próxima do preço em cada lado — o que o painel destaca.
    nearestFvg: nearestZone(fvgs, price),
    nearestBlock: nearestZone(blocks, price),
  };
}

/** Zona (gap ou bloco) cujo centro está mais perto do preço. */
function nearestZone(zones, price) {
  let best = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const mid = (z.top + z.bottom) / 2;
    const d = Math.abs(mid - price);
    if (d < bestDist) {
      bestDist = d;
      best = z;
    }
  }
  return best;
}
