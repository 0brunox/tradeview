// Killzones, Asian range, Power of 3 e Judas Swing.
//
// As killzones do ICT são definidas em HORÁRIO DE NOVA YORK e acompanham o
// horário de verão americano — por isso a conversão passa pelo `Intl` com
// `timeZone: 'America/New_York'` em vez de um deslocamento fixo. Um offset
// cravado em -5h erraria metade do ano.
//
// Power of 3 (AMD): o ICT lê o dia em três atos — Acumulação (o range apertado
// da sessão asiática), Manipulação (o *Judas Swing*, o falso rompimento que
// varre os stops de um lado) e Distribuição (a expansão de verdade, para o lado
// oposto ao da manipulação).

// Killzones em hora local de NY. `to` é exclusivo.
export const KILLZONES = [
  { id: 'asia', label: 'Ásia', from: 20, to: 24 },
  { id: 'london', label: 'London Open', from: 2, to: 5 },
  { id: 'nyopen', label: 'NY Open', from: 7, to: 10 },
  { id: 'nyclose', label: 'London Close', from: 10, to: 12 },
];

// Um candle de 4h ou mais atravessa killzones inteiras — sombreá-lo sugeriria
// uma precisão de horário que o timeframe não tem.
const SESSION_TFS = new Set(['1m', '5m', '15m', '1h']);

/** O timeframe tem resolução suficiente para marcar sessões? */
export function supportsSessions(interval) {
  return SESSION_TFS.has(interval);
}

const NY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// `Intl` não é barato para chamar por candle. O offset de NY só muda duas vezes
// por ano, então basta memorizá-lo por hora UTC: o cache absorve a varredura
// inteira e ainda resolve corretamente os dois dias de virada do DST.
const offsetCache = new Map();
const CACHE_MAX = 4000;

function nyOffsetMinutes(epochSec) {
  const key = Math.floor(epochSec / 3600);
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;

  const parts = NY_FMT.formatToParts(new Date(epochSec * 1000));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) / 1000;
  const offset = Math.round((asUtc - epochSec) / 60);

  if (offsetCache.size > CACHE_MAX) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/** Hora (0–23) e índice de dia locais de Nova York para um epoch em segundos. */
export function nyTime(epochSec) {
  const shifted = epochSec + nyOffsetMinutes(epochSec) * 60;
  return { hour: Math.floor(shifted / 3600) % 24, day: Math.floor(shifted / 86400) };
}

/** Killzone que contém uma hora local de NY, ou null. */
export function zoneForHour(hour) {
  for (const z of KILLZONES) if (hour >= z.from && hour < z.to) return z;
  return null;
}

/** Killzone ativa agora (usa o relógio do navegador). → zona | null */
export function activeKillzone(nowSec = Date.now() / 1000) {
  return zoneForHour(nyTime(nowSec).hour);
}

/**
 * Faixas de tempo a sombrear, agrupando candles consecutivos da mesma killzone.
 *
 * `from` e `to` são horários de candles REAIS — `timeToCoordinate` devolve null
 * para qualquer instante que não seja um ponto da série, então quem desenha
 * estende a faixa somando um `barSpacing` à direita em vez de receber aqui um
 * timestamp sintético de fim.
 * → [{ id, label, from, to }]  (epoch em segundos)
 */
export function killzones(candles, { maxCandles = 300 } = {}) {
  const bands = [];
  if (!candles || candles.length < 2) return bands;

  const start = Math.max(0, candles.length - maxCandles);
  let current = null;
  let prevIndex = -2;

  for (let i = start; i < candles.length; i++) {
    const zone = zoneForHour(nyTime(candles[i].time).hour);
    if (!zone) {
      current = null;
      continue;
    }
    if (current && current.id === zone.id && prevIndex === i - 1) {
      current.to = candles[i].time;
    } else {
      current = { id: zone.id, label: zone.label, from: candles[i].time, to: candles[i].time };
      bands.push(current);
    }
    prevIndex = i;
  }
  return bands;
}

/**
 * Último bloco contíguo da sessão asiática — a acumulação do Power of 3.
 * → { high, low, from, to, endIndex } | null
 */
export function asianRange(candles) {
  if (!candles || !candles.length) return null;

  const isAsia = (c) => zoneForHour(nyTime(c.time).hour)?.id === 'asia';
  let end = -1;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (isAsia(candles[i])) { end = i; break; }
  }
  if (end < 0) return null;

  let begin = end;
  while (begin > 0 && isAsia(candles[begin - 1])) begin--;

  let high = -Infinity;
  let low = Infinity;
  for (let i = begin; i <= end; i++) {
    if (candles[i].high > high) high = candles[i].high;
    if (candles[i].low < low) low = candles[i].low;
  }

  return { high, low, from: candles[begin].time, to: candles[end].time, endIndex: end };
}

/**
 * Power of 3 do pregão atual, lido a partir do range asiático.
 *
 * A manipulação é o primeiro lado do range asiático a ser varrido depois que
 * ele fecha — e o viés esperado é o OPOSTO, que é a leitura toda do Judas
 * Swing: o movimento inicial existe para pegar liquidez, não para durar.
 *
 * → { phase, asia, judas, bias } | null
 */
export function powerOfThree(candles) {
  const asia = asianRange(candles);
  if (!asia) return null;

  const after = candles.slice(asia.endIndex + 1);
  if (!after.length) return { phase: 'accumulation', asia, judas: null, bias: null };

  let judas = null;
  for (const c of after) {
    if (c.high > asia.high) { judas = { time: c.time, price: c.high, dir: 'up' }; break; }
    if (c.low < asia.low) { judas = { time: c.time, price: c.low, dir: 'down' }; break; }
  }
  if (!judas) return { phase: 'accumulation', asia, judas: null, bias: null };

  // Viés esperado: contrário ao lado varrido.
  const bias = judas.dir === 'up' ? 'bear' : 'bull';

  // A distribuição se confirma quando o preço fecha além do lado OPOSTO ao da varredura.
  const confirmed = after.some((c) =>
    (bias === 'bear' && c.close < asia.low) || (bias === 'bull' && c.close > asia.high));

  return { phase: confirmed ? 'distribution' : 'manipulation', asia, judas, bias };
}
