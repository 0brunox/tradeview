// Liquidez: onde estão os stops, e quando eles são varridos.
//
// O ICT lê topos e fundos como *pools* de liquidez — acima de um topo há stops
// de vendido e ordens de compra (Buyside Liquidity, BSL); abaixo de um fundo,
// o contrário (Sellside Liquidity, SSL). Topos/fundos aproximadamente iguais
// (EQH / EQL) concentram ainda mais ordens, e é justamente para lá que o preço
// costuma ser atraído ("draw on liquidity").
//
// O evento que interessa é o *sweep* (raid / stop hunt): o pavio ultrapassa o
// pool e o candle FECHA de volta do lado de origem. Se o candle fecha além do
// nível, não houve caça a stop — o nível simplesmente foi rompido e deixou de
// ser liquidez.

import { avgRange } from './util.js';
import { swingPoints } from './structure.js';

/** Agrupa pontos cujos preços estão a menos de `tol` um do outro. */
function clusterByPrice(points, tol) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const groups = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].price - current[current.length - 1].price <= tol) current.push(sorted[i]);
    else {
      groups.push(current);
      current = [sorted[i]];
    }
  }
  groups.push(current);
  return groups;
}

/**
 * Pools de liquidez acima dos topos e abaixo dos fundos recentes.
 *
 * @param tolMult tolerância do agrupamento como fração do range médio — é o que
 *   define "topos iguais". Relativo, e não percentual fixo, porque a mesma
 *   distância que é ruído num ativo é um nível distinto noutro.
 * → [{ price, kind: 'BSL'|'SSL', touches, lastIndex, lastTime,
 *      swept, sweptTime, distancePct }]  ordenado por proximidade do preço atual
 */
export function liquidityPools(candles, {
  lookback = 150, strength = 2, tolMult = 0.25, maxPools = 6,
} = {}) {
  if (!candles || candles.length < 10) return [];

  const start = Math.max(0, candles.length - lookback);
  const swings = swingPoints(candles, strength).filter((s) => s.index >= start);
  if (!swings.length) return [];

  const tol = avgRange(candles, 20) * tolMult;
  const price = candles[candles.length - 1].close;
  const pools = [];

  for (const kind of ['BSL', 'SSL']) {
    const wanted = kind === 'BSL' ? 'high' : 'low';
    const groups = clusterByPrice(swings.filter((s) => s.kind === wanted), tol);

    for (const group of groups) {
      // Os stops ficam além do extremo do agrupamento, não na média dele.
      const level = kind === 'BSL'
        ? Math.max(...group.map((p) => p.price))
        : Math.min(...group.map((p) => p.price));
      const lastIndex = Math.max(...group.map((p) => p.index));

      // A partir do último toque: o nível foi varrido, rompido, ou segue intacto?
      let swept = false;
      let sweptTime = null;
      let broken = false;
      for (let i = lastIndex + strength + 1; i < candles.length; i++) {
        const c = candles[i];
        if (kind === 'BSL' && c.high > level) {
          if (c.close < level) { swept = true; sweptTime = c.time; } else { broken = true; }
        } else if (kind === 'SSL' && c.low < level) {
          if (c.close > level) { swept = true; sweptTime = c.time; } else { broken = true; }
        }
        if (broken) break;
      }
      if (broken) continue; // rompido de vez: não é mais um pool

      pools.push({
        price: level,
        kind,
        touches: group.length,
        lastIndex,
        lastTime: candles[lastIndex].time,
        swept,
        sweptTime,
        distancePct: price ? ((level - price) / price) * 100 : null,
      });
    }
  }

  // Mais toques primeiro (pool mais gordo), depois o mais perto do preço.
  pools.sort((a, b) => (b.touches - a.touches) || (Math.abs(a.distancePct) - Math.abs(b.distancePct)));
  return pools.slice(0, maxPools).sort((a, b) => b.price - a.price);
}

/**
 * Os alvos imediatos acima e abaixo do preço — o "draw on liquidity" de cada lado.
 * → { above: pool|null, below: pool|null }
 */
export function nearestTargets(pools, price) {
  let above = null;
  let below = null;
  for (const p of pools) {
    if (p.swept) continue; // já foi tomado; não é mais o ímã
    if (p.price > price && (!above || p.price < above.price)) above = p;
    if (p.price < price && (!below || p.price > below.price)) below = p;
  }
  return { above, below };
}
