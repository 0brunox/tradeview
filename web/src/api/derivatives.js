// Free, browser-direct derivatives data from Binance USDT-M futures.
// Open Interest history is public and sends CORS `Access-Control-Allow-Origin: *`.
// Docs: GET /futures/data/openInterestHist
const BINANCE_FAPI = 'https://fapi.binance.com';

// Binance only accepts these OI-history periods.
const OI_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);

/**
 * Recent open-interest history for a perp symbol (e.g. BTCUSDT).
 * `sumOpenInterestValue / sumOpenInterest` gives the mark price at each point,
 * so callers get position notional AND the price it was opened at, for free.
 * → [{ time, oiUsd, oiBase }]  (empty when the symbol has no Binance perp)
 */
export async function fetchOpenInterestHist(symbol, period = '1h', limit = 500) {
  const p = OI_PERIODS.has(period) ? period : '1h';
  const url =
    `${BINANCE_FAPI}/futures/data/openInterestHist` +
    `?symbol=${encodeURIComponent(symbol)}&period=${p}&limit=${Math.min(limit, 500)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OI ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    time: Math.floor(r.timestamp / 1000),
    oiUsd: Number(r.sumOpenInterestValue),
    oiBase: Number(r.sumOpenInterest),
  }));
}

/**
 * Taxa de funding atual do perp (e mark price) — GET /fapi/v1/premiumIndex.
 * `lastFundingRate` vem como fração por período de 8h (0.0001 = 0.01%).
 * → { rate, ratePct, markPrice, nextFundingTime } ou null se o símbolo não tem perp.
 */
export async function fetchFundingRate(symbol) {
  try {
    const url = `${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const r = await res.json();
    if (!r || r.lastFundingRate == null) return null;
    const rate = Number(r.lastFundingRate);
    return {
      rate,
      ratePct: rate * 100,
      markPrice: Number(r.markPrice),
      nextFundingTime: Number(r.nextFundingTime),
      // juros base da fórmula de funding (0,01% por período, no padrão)
      interestRate: r.interestRate != null ? Number(r.interestRate) : 0.0001,
    };
  } catch {
    return null;
  }
}

/**
 * Resumo do Open Interest: valor atual em USD e variação nas últimas 24h.
 * Usa o histórico de 1h (24 pontos ≈ 1 dia) para não precisar de outro endpoint.
 * → { oiUsd, oiBase, changePct24h } ou null.
 */
export async function fetchOpenInterestSummary(symbol) {
  try {
    const rows = await fetchOpenInterestHist(symbol, '1h', 25);
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const first = rows[0];
    const changePct24h =
      first.oiUsd > 0 ? ((last.oiUsd - first.oiUsd) / first.oiUsd) * 100 : null;
    return { oiUsd: last.oiUsd, oiBase: last.oiBase, changePct24h, points: rows.length };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fluxo agregado de derivativos (Open Interest + funding), somando as duas
// corretoras que o app já fala: Binance USDT-M e Bybit linear. Ambas mandam
// CORS liberado, então tudo roda no browser, sem backend.
// ---------------------------------------------------------------------------

const BYBIT_REST = 'https://api.bybit.com';
const HOUR_MS = 3600 * 1000;

// Duração de cada timeframe do app, em ms. 1w/1M são aproximações — só servem
// para dimensionar a janela de 8h do funding, nunca para encaixar dados no
// eixo (isso é feito contra os candles reais, em indicators/flow.js).
const INTERVAL_MS = {
  '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
  '1h': HOUR_MS, '2h': 2 * HOUR_MS, '4h': 4 * HOUR_MS, '6h': 6 * HOUR_MS,
  '12h': 12 * HOUR_MS, '1d': 24 * HOUR_MS, '1w': 7 * 24 * HOUR_MS, '1M': 30 * 24 * HOUR_MS,
};

// Granularidade do histórico de OI por timeframe do gráfico. Abaixo de 4h o
// limite é o teto de 500 pontos do endpoint, então o período acompanha o
// timeframe para cobrir a maior janela possível; de 4h para cima quem manda é a
// retenção de ~30 dias da Binance, e aí vale puxar fino (4h/1d) para o candle de
// OI ter corpo em vez de um ponto só.
const OI_PERIOD_BY_INTERVAL = {
  '1m': '5m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h',
  '12h': '4h', '1d': '4h', '1w': '1d', '1M': '1d',
};

// A Bybit tem menos períodos que a Binance; quando falta o exato, usa-se o mais
// fino disponível — a união das séries é feita com forward fill, então
// granularidades diferentes não atrapalham a soma.
const BYBIT_OI_INTERVAL = {
  '5m': '5min', '15m': '15min', '30m': '30min',
  '1h': '1h', '2h': '1h', '4h': '4h', '6h': '4h', '12h': '4h', '1d': '1d',
};

export function oiPeriodFor(interval) {
  return OI_PERIOD_BY_INTERVAL[interval] ?? '1h';
}

// Memecoins entram no perp em lotes: o spot é PEPEUSDT, o contrato é
// 1000PEPEUSDT (1000000 nos casos mais extremos). Sem traduzir o nome, todo o
// fluxo de derivativos volta vazio justamente nos ativos onde ele mais importa.
const LOT_PREFIXES = ['', '1000', '10000', '1000000'];
const perpCache = new Map(); // símbolo spot → nome no perp (ou null se não existe)

/**
 * Nome do contrato perpétuo correspondente a um símbolo spot, testado uma vez
 * por sessão contra a Binance (endpoint de 1 ponto, barato).
 * → string ou null quando o ativo não tem perp.
 */
export async function resolvePerpSymbol(symbol) {
  if (perpCache.has(symbol)) return perpCache.get(symbol);
  let found = null;
  for (const prefix of LOT_PREFIXES) {
    const name = prefix + symbol;
    // eslint-disable-next-line no-await-in-loop
    const ok = await fetch(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${encodeURIComponent(name)}`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) { found = name; break; }
  }
  perpCache.set(symbol, found);
  return found;
}

// OI da Binance em moedas do ativo base → [{ t (ms), v }]
async function binanceOiRows(symbol, period, limit = 500) {
  const rows = await fetchOpenInterestHist(symbol, period, limit);
  return rows.map((r) => ({ t: r.time * 1000, v: r.oiBase }));
}

/**
 * OI da Bybit (perp linear) no mesmo período, paginando com o cursor até cobrir
 * a janela pedida — cada página traz no máximo 200 pontos, do mais novo ao mais
 * antigo. → [{ t (ms), v }] em ordem crescente.
 */
async function bybitOiRows(symbol, period, sinceMs = 0, maxPages = 3) {
  const iv = BYBIT_OI_INTERVAL[period];
  if (!iv) return [];
  const out = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page += 1) {
    const url =
      `${BYBIT_REST}/v5/market/open-interest?category=linear` +
      `&symbol=${encodeURIComponent(symbol)}&intervalTime=${iv}&limit=200` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url);
    if (!res.ok) break;
    const j = await res.json();
    if (j.retCode !== 0) break;
    const list = j.result?.list ?? [];
    if (list.length === 0) break;
    for (const r of list) {
      // `openInterest` soma os dois lados do book; `singleOpenInterest` é o lado
      // único — é esse que tem a mesma convenção do sumOpenInterest da Binance.
      const single = r.singleOpenInterest != null ? +r.singleOpenInterest : +r.openInterest / 2;
      out.push({ t: Number(r.timestamp), v: single });
    }
    cursor = j.result?.nextPageCursor ?? '';
    if (!cursor || Number(list[list.length - 1].timestamp) <= sinceMs) break;
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Soma séries de corretoras diferentes num eixo de tempo só.
 * Cada fonte carrega o último valor conhecido (forward fill) e o total só
 * começa quando todas já têm valor — somar antes disso desenharia um degrau
 * falso, do tamanho da fonte que entrou depois. Uma fonte curta demais é
 * descartada em vez de encurtar o agregado inteiro.
 * → { rows: [{ t, v, parts }], sources: [nome…] }
 */
function mergeSources(entries) {
  let keep = entries.filter((e) => e.rows.length >= 2);
  if (keep.length === 0) return { rows: [], sources: [] };

  while (keep.length > 1) {
    const spans = keep.map((e) => e.rows[e.rows.length - 1].t - e.rows[0].t);
    const longest = Math.max(...spans);
    const from = Math.max(...keep.map((e) => e.rows[0].t));
    const to = Math.min(...keep.map((e) => e.rows[e.rows.length - 1].t));
    if (to - from >= longest * 0.6) break; // sobra história suficiente: mantém todas
    const shortest = spans.indexOf(Math.min(...spans));
    keep = keep.filter((_, i) => i !== shortest);
  }

  const start = Math.max(...keep.map((e) => e.rows[0].t));
  const times = [...new Set(keep.flatMap((e) => e.rows.map((r) => r.t)))]
    .filter((t) => t >= start)
    .sort((a, b) => a - b);

  const cursor = keep.map(() => 0);
  const last = keep.map(() => null);
  const rows = [];
  for (const t of times) {
    for (let i = 0; i < keep.length; i += 1) {
      const src = keep[i].rows;
      while (cursor[i] < src.length && src[cursor[i]].t <= t) {
        last[i] = src[cursor[i]].v;
        cursor[i] += 1;
      }
    }
    if (last.some((v) => v == null)) continue;
    const parts = {};
    for (let i = 0; i < keep.length; i += 1) parts[keep[i].name] = last[i];
    rows.push({ t, v: last.reduce((a, b) => a + b, 0), parts });
  }
  return { rows, sources: keep.map((e) => e.name) };
}

/**
 * Open Interest agregado (Binance + Bybit), em moedas do ativo base.
 * A Bybit é buscada depois da Binance para parar de paginar assim que cobrir a
 * mesma janela — sem isso ela traria história muito mais longa e o critério de
 * corte do mergeSources jogaria a Binance fora.
 * → { rows: [{ t, v, parts }], sources, period }
 */
export async function fetchAggOpenInterest(symbol, interval) {
  const period = oiPeriodFor(interval);
  const perp = (await resolvePerpSymbol(symbol)) ?? symbol;
  const binance = await binanceOiRows(perp, period).catch(() => []);
  const bybit = await bybitOiRows(perp, period, binance[0]?.t ?? 0, binance.length ? 3 : 2)
    .catch(() => []);
  const merged = mergeSources([
    { name: 'binance', rows: binance },
    { name: 'bybit', rows: bybit },
  ]);
  return { ...merged, period };
}

/**
 * OI atual de cada corretora (1 chamada barata por fonte) — usado só como peso
 * do funding quando o painel de OI está desligado.
 * → { binance?: n, bybit?: n }
 */
export async function fetchCurrentOi(symbol) {
  const out = {};
  const perp = (await resolvePerpSymbol(symbol)) ?? symbol;
  await Promise.all([
    fetch(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${encodeURIComponent(perp)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.openInterest != null) out.binance = Number(j.openInterest); })
      .catch(() => {}),
    bybitOiRows(perp, '1h', 0, 1)
      .then((rows) => { if (rows.length) out.bybit = rows[rows.length - 1].v; })
      .catch(() => {}),
  ]);
  return out;
}

// --- funding ---------------------------------------------------------------

// Teto do ajuste de juros na fórmula de funding da Binance (±0,05%).
const FUNDING_CLAMP = 0.0005;
const FUNDING_WINDOW_MS = 8 * HOUR_MS; // período padrão de funding

// funding = premium + clamp(juros − premium, ±0,05%)
function fundingFromPremium(premium, interestRate) {
  const adj = Math.min(FUNDING_CLAMP, Math.max(-FUNDING_CLAMP, interestRate - premium));
  return premium + adj;
}

// Média móvel simples com janela parcial no começo (os primeiros pontos usam o
// que existe, em vez de sumirem do gráfico).
function rollingMean(values, window) {
  const out = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out[i] = sum / Math.min(i + 1, window);
  }
  return out;
}

/**
 * Funding contínuo estimado da Binance: um valor por candle, a partir do
 * premium index médio das últimas 8h — que é o que a taxa do próximo pagamento
 * está medindo. Mostra a pressão de posicionamento candle a candle, em vez de
 * repetir a taxa liquidada em degraus de 8h.
 * → [{ t (ms), rate }]
 */
async function binanceFundingRows(symbol, interval, limit = 1500) {
  const url =
    `${BINANCE_FAPI}/fapi/v1/premiumIndexKlines` +
    `?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}` +
    `&limit=${Math.min(limit, 1500)}`;
  const [res, info] = await Promise.all([fetch(url), fetchFundingRate(symbol)]);
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const interestRate = info?.interestRate ?? 0.0001;
  const bars = Math.max(1, Math.round(FUNDING_WINDOW_MS / (INTERVAL_MS[interval] ?? HOUR_MS)));
  const premium = rows.map((k) => +k[4]); // fechamento do premium index
  const avg = rollingMean(premium, bars);
  return rows.map((k, i) => ({ t: k[0], rate: fundingFromPremium(avg[i], interestRate) }));
}

/**
 * Taxas de funding já liquidadas na Bybit (a cada 8h). Cada taxa mede a janela
 * que acabou de fechar, igual à média de 8h da Binance, então as duas séries
 * ficam no mesmo referencial de tempo. → [{ t (ms), rate }]
 */
async function bybitFundingRows(symbol, limit = 200) {
  const url =
    `${BYBIT_REST}/v5/market/funding/history?category=linear` +
    `&symbol=${encodeURIComponent(symbol)}&limit=${Math.min(limit, 200)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const j = await res.json();
  if (j.retCode !== 0) return [];
  return (j.result?.list ?? [])
    .map((r) => ({ t: Number(r.fundingRateTimestamp), rate: +r.fundingRate }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Séries de funding por corretora, prontas para a média ponderada por OI
 * (feita em indicators/flow.js, onde o eixo dos candles é conhecido).
 * → { series: { binance?: [...], bybit?: [...] }, sources: [...] }
 */
export async function fetchFundingSources(symbol, interval) {
  const perp = (await resolvePerpSymbol(symbol)) ?? symbol;
  const [binance, bybit] = await Promise.all([
    binanceFundingRows(perp, interval).catch(() => []),
    bybitFundingRows(perp).catch(() => []),
  ]);
  const series = {};
  if (binance.length) series.binance = binance;
  if (bybit.length) series.bybit = bybit;
  return { series, sources: Object.keys(series) };
}
