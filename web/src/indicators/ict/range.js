// Dealing range: premium / discount / equilíbrio e a zona OTE.
//
// O ICT divide o range em que o preço está operando ao meio. Acima do
// equilíbrio (50%) o preço está caro — *premium*, região onde ele procura
// vendas. Abaixo, barato — *discount*, região de compras. Operar comprado no
// premium é o erro que ele mais repete na série.
//
// A OTE (Optimal Trade Entry) é a fatia de 0.62 a 0.79 de retração da perna de
// impulso, com 0.705 como ponto ideal — sempre no lado descontado da perna.

const OTE_START = 0.62;
const OTE_SWEET = 0.705;
const OTE_END = 0.79;

/**
 * @param lookback janela que define o range operacional. O extremo mais recente
 *   entre topo e fundo determina a direção da perna: se o topo veio depois do
 *   fundo, a perna foi de alta e a OTE é uma zona de COMPRA na retração.
 * → {
 *     high, low, highTime, lowTime, equilibrium, size,
 *     dir: 'bull' | 'bear',                  direção da perna de impulso
 *     zone: 'premium' | 'discount' | 'equilibrium',
 *     pricePct,                              0 = fundo do range, 1 = topo
 *     ote: { top, bottom, sweet },
 *     inOte
 *   }  ou null se não houver candles suficientes.
 */
export function dealingRange(candles, { lookback = 120 } = {}) {
  if (!candles || candles.length < 10) return null;

  const slice = candles.slice(-lookback);
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].high > slice[hi].high) hi = i;
    if (slice[i].low < slice[lo].low) lo = i;
  }

  const high = slice[hi].high;
  const low = slice[lo].low;
  const size = high - low;
  if (!(size > 0)) return null;

  const price = slice[slice.length - 1].close;
  const equilibrium = (high + low) / 2;
  const pricePct = (price - low) / size;
  const dir = hi > lo ? 'bull' : 'bear';

  // Retração medida a partir do extremo em que a perna terminou.
  const level = (r) => (dir === 'bull' ? high - size * r : low + size * r);
  const a = level(OTE_START);
  const b = level(OTE_END);
  const ote = { top: Math.max(a, b), bottom: Math.min(a, b), sweet: level(OTE_SWEET) };

  return {
    high,
    low,
    highTime: slice[hi].time,
    lowTime: slice[lo].time,
    equilibrium,
    size,
    dir,
    // Faixa estreita em torno dos 50% para não chamar de "premium" um preço
    // que está praticamente no equilíbrio.
    zone: pricePct > 0.52 ? 'premium' : pricePct < 0.48 ? 'discount' : 'equilibrium',
    pricePct,
    ote,
    inOte: price >= ote.bottom && price <= ote.top,
  };
}
