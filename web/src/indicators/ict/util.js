// Utilidades compartilhadas pelos módulos ICT.
//
// As tolerâncias do ICT (o que é "displacement", o que conta como topo duplo)
// são relativas à volatilidade do ativo, não percentuais fixos: 0.3% é ruído no
// PEPE e um movimento enorme no BTC. Por isso quase tudo aqui se ancora no
// range médio dos candles recentes.

/** Range médio (high − low) dos últimos `n` candles. → 0 se não houver dados. */
export function avgRange(candles, n = 20) {
  if (!candles || !candles.length) return 0;
  const slice = candles.slice(-n);
  let sum = 0;
  for (const c of slice) sum += c.high - c.low;
  return sum / slice.length;
}

/** Média simples de um array de números (null se vazio). */
export function mean(values) {
  if (!values || !values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Confina `v` ao intervalo [min, max]. */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Candle de alta (fechamento acima da abertura). */
export const isUp = (c) => c.close >= c.open;

/** Candle de baixa. */
export const isDown = (c) => c.close < c.open;
