// Monta o retrato do mercado que alimenta a análise de IA.
// Tudo é calculado no browser (mesma filosofia dos indicadores do gráfico) e
// enviado ao endpoint /api/analyze como números puros — nenhum texto livre.
import { fetchCandles } from '../api/rest.js';
import { fetchTicker24h } from '../api/binance.js';
import {
  fetchAggOpenInterest,
  fetchFundingRate,
  fetchFundingSources,
  fetchOpenInterestSummary,
} from '../api/derivatives.js';
import { fetchSpotDelta } from '../api/spotFlow.js';
import { parseSymbol } from '../api/source.js';
import { sma } from '../indicators/sma.js';
import { ema } from '../indicators/ema.js';
import { macd } from '../indicators/macd.js';
import { bollinger } from '../indicators/bollinger.js';
import { rsi } from '../indicators/rsi.js';
import { kdj } from '../indicators/kdj.js';
import { pivotPoints, swingLevels, rangeExtremes } from '../indicators/levels.js';
import { cvdCandles, oiCandles, fundingSeries } from '../indicators/flow.js';
import { buildIctContext } from '../indicators/ict/index.js';

// Timeframes do painel RSI multi-timeframe, reaproveitados aqui.
const MTF = ['5m', '15m', '1h', '4h', '12h', '1d', '1w'];
const MTF_LIMIT = 200; // histórico suficiente para o RSI de Wilder convergir
const CANDLES_IN_PAYLOAD = 40; // candles recentes enviados ao modelo
const CVD_WINDOW = 20; // janela curta de CVD, igual à média de volume
// Delta acumulado abaixo deste percentual do volume da janela é ruído, não
// inclinação — serve para o `slope` não chamar de tendência um CVD de lado.
const CVD_FLAT_PCT = 0.5;
const DAY_MS = 24 * 3600 * 1000;

/** Arredonda para `sig` dígitos significativos; devolve null para valores inválidos. */
function num(v, sig = 8) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v === 0) return 0;
  return Number(v.toPrecision(sig));
}

/** Último valor de uma série [{ time, value }]. */
function last(series) {
  return series && series.length ? series[series.length - 1].value : null;
}

/** Últimos `n` valores de uma série, do mais antigo para o mais recente. */
function tail(series, n) {
  return (series ?? []).slice(-n).map((p) => num(p.value, 6));
}

/** Média simples de um array de números. */
function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Médias móveis simples/exponenciais nos períodos usados na leitura clássica. */
function movingAverages(candles) {
  const out = {};
  for (const p of [5, 10, 20, 60, 120]) {
    out[`ma${p}`] = candles.length > p ? num(last(sma(candles, p))) : null;
  }
  for (const p of [9, 21]) {
    out[`ema${p}`] = candles.length > p ? num(last(ema(candles, p))) : null;
  }
  return out;
}

// --- fluxo agregado --------------------------------------------------------
// As séries de CVD spot, Open Interest e funding passam pelas mesmas funções
// puras que desenham os painéis do gráfico (indicators/flow.js), então o que a
// IA lê é o que está na tela. Daqui saem só os números derivados: nível atual,
// variação nas janelas que interessam e sinal da inclinação.

/** Variação do fechamento de uma série de candles ao longo dos últimos `n`. */
function changeOverBars(series, n) {
  if (!series || series.length < 2) return null;
  const from = series[Math.max(0, series.length - 1 - n)];
  return series[series.length - 1].close - from.close;
}

/**
 * Leitura do CVD spot. O acumulado é ancorado em zero no primeiro candle, então
 * o nível não diz nada — o que informa é a inclinação, e ela só faz sentido
 * medida contra o volume do período (um delta de mil moedas é muito num ativo
 * que girou dez mil e irrelevante num que girou dez milhões).
 * → null quando o ativo não tem mercado spot na Binance.
 */
function cvdFlow(delta, candleTimes) {
  const series = cvdCandles(delta?.rows ?? [], candleTimes);
  if (series.length < 2) return null;

  const change = changeOverBars(series, CVD_WINDOW);
  // Volume dos dois lados nos mesmos candles da janela, para escalar o delta.
  const since = candleTimes[Math.max(0, candleTimes.length - CVD_WINDOW)] * 1000;
  const traded = delta.rows
    .filter((r) => r.time >= since)
    .reduce((acc, r) => acc + r.buy + r.sell, 0);
  const pctOfVolume = traded > 0 ? (change / traded) * 100 : null;

  let slope = null;
  if (pctOfVolume != null) {
    if (pctOfVolume > CVD_FLAT_PCT) slope = 'up';
    else if (pctOfVolume < -CVD_FLAT_PCT) slope = 'down';
    else slope = 'flat';
  }

  const bar = series[series.length - 1];
  return {
    changeLast20: num(change, 6),
    changeLast5: num(changeOverBars(series, 5), 6),
    changePctOfVolume: num(pctOfVolume, 4),
    barDelta: num(bar.close - bar.open, 6),
    slope,
    bars: series.length,
    marketCount: delta.markets?.length ?? null,
  };
}

/**
 * Leitura do Open Interest agregado, em moedas do ativo base. A variação de 24h
 * só vai quando a janela carregada alcança o dia inteiro — a Binance guarda
 * ~30 dias de histórico de OI, mas em timeframes curtos o teto de 500 pontos
 * deixa a janela bem menor que isso.
 * → null quando nenhuma corretora tem perp do ativo.
 */
function oiFlow(agg, candleTimes) {
  const series = oiCandles(agg?.rows ?? [], candleTimes);
  if (series.length < 2) return null;

  const current = series[series.length - 1].close;
  const windowOpen = series[0].open;
  const rows = agg.rows;
  const cutoff = rows[rows.length - 1].t - DAY_MS;
  const dayAgo = rows[0].t <= cutoff ? rows.find((r) => r.t >= cutoff) : null;

  return {
    current: num(current, 6),
    changePctWindow: windowOpen > 0 ? num(((current - windowOpen) / windowOpen) * 100, 4) : null,
    changePct24h: dayAgo?.v > 0 ? num(((current - dayAgo.v) / dayAgo.v) * 100, 4) : null,
    bars: series.length,
    sources: agg.sources ?? [],
  };
}

/**
 * Leitura do funding agregado, em % por período de 8h. `negativeBars` é a
 * contagem de candles com taxa negativa (shorts pagando longs) — é o que mostra
 * posicionamento vendido persistente, que a taxa atual sozinha esconde.
 * → null quando o ativo não tem perp.
 */
function fundingFlow(src, weights, candleTimes) {
  const series = fundingSeries(src?.series ?? {}, weights, candleTimes);
  if (!series.length) return null;

  const values = series.map((p) => p.value);
  return {
    currentPct: num(values[values.length - 1], 6),
    avgPct: num(mean(values), 6),
    negativeBars: values.filter((v) => v < 0).length,
    bars: values.length,
    sources: src.sources ?? [],
  };
}

/** RSI final de cada timeframe, buscando os candles em paralelo. */
async function multiTimeframeRsi(fullSymbol, period) {
  const results = await Promise.all(
    MTF.map((tf) =>
      fetchCandles(fullSymbol, tf, MTF_LIMIT)
        .then((cs) => [tf, cs.length > period ? num(last(rsi(cs, period)), 4) : null])
        .catch(() => [tf, null]),
    ),
  );
  return Object.fromEntries(results);
}

/**
 * Retrato completo do ativo/timeframe atual.
 * `candles` são os candles já carregados pelo gráfico (evita refetch).
 * Fontes indisponíveis (ex.: perp inexistente, símbolo da Bybit) viram null —
 * a análise segue com o que houver.
 */
export async function buildSnapshot({ fullSymbol, interval, candles, rsiPeriod = 14 }) {
  if (!candles || candles.length < 30) {
    throw new Error('Histórico insuficiente para análise (mínimo 30 candles).');
  }

  const { source, symbol } = parseSymbol(fullSymbol);
  const isBinance = source === 'binance';

  const candleTimes = candles.map((c) => c.time);

  // Rede: 24h + derivativos + fluxo agregado + RSI multi-timeframe, em paralelo.
  // O fluxo não depende da corretora do gráfico (ele soma Binance + Bybit, como
  // nos painéis), mas cada fonte cai sozinha para null: ativo sem perp
  // (BTCBRL), memecoin que só existe em lote ou corretora fora do ar apagam
  // apenas o bloco correspondente.
  const [ticker, funding, oi, spotDelta, aggOi, fundingSrc, rsiMtf] = await Promise.all([
    isBinance ? fetchTicker24h(symbol) : Promise.resolve(null),
    isBinance ? fetchFundingRate(symbol) : Promise.resolve(null),
    isBinance ? fetchOpenInterestSummary(symbol) : Promise.resolve(null),
    fetchSpotDelta(symbol, interval).catch(() => null),
    fetchAggOpenInterest(symbol, interval).catch(() => null),
    fetchFundingSources(symbol, interval).catch(() => null),
    multiTimeframeRsi(fullSymbol, rsiPeriod),
  ]);

  // Peso de cada corretora na média do funding: o OI que ela tem agora. Sem
  // histórico de OI o fundingSeries divide o peso igualmente entre as fontes.
  const oiWeights = aggOi?.rows?.length ? aggOi.rows[aggOi.rows.length - 1].parts : null;

  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const price = lastCandle.close;

  const m = macd(candles, 12, 26, 9);
  const bb = bollinger(candles, 20, 2);
  const bbUpper = last(bb.upper);
  const bbMiddle = last(bb.middle);
  const bbLower = last(bb.lower);
  const bbRange = bbUpper != null && bbLower != null ? bbUpper - bbLower : null;

  const k = kdj(candles, 9);
  const lastK = k.length ? k[k.length - 1] : null;
  const prevK = k.length > 1 ? k[k.length - 2] : null;

  const volumes = candles.slice(-20).map((c) => c.volume);
  const avgVol20 = mean(volumes);

  const swings = swingLevels(candles, { lookback: 150, strength: 3, max: 4 });
  const ict = buildIctContext(candles, { symbol: fullSymbol, interval });

  return {
    symbol: fullSymbol,
    exchange: source,
    interval,
    generatedAt: new Date().toISOString(),

    price: {
      last: num(price),
      // Fallback para a variação do próprio candle quando não há ticker 24h.
      changePct24h: num(ticker?.changePct ?? null, 4),
      high24h: num(ticker?.high ?? null),
      low24h: num(ticker?.low ?? null),
      volume24h: num(ticker?.volume ?? null, 6),
      quoteVolume24h: num(ticker?.quoteVolume ?? null, 6),
      barChangePct: num(((price - lastCandle.open) / lastCandle.open) * 100, 4),
    },

    ma: movingAverages(candles),

    macd: {
      dif: num(last(m.macdLine), 6),
      dea: num(last(m.signalLine), 6),
      hist: num(last(m.histogram), 6),
      histPrev: m.histogram.length > 1 ? num(m.histogram[m.histogram.length - 2].value, 6) : null,
    },

    boll: {
      upper: num(bbUpper),
      middle: num(bbMiddle),
      lower: num(bbLower),
      // %B: 0 na banda inferior, 1 na superior.
      percentB: bbRange ? num((price - bbLower) / bbRange, 4) : null,
      bandwidthPct: bbRange && bbMiddle ? num((bbRange / bbMiddle) * 100, 4) : null,
    },

    rsi: {
      period: rsiPeriod,
      current: num(last(rsi(candles, rsiPeriod)), 4),
      recent: tail(rsi(candles, rsiPeriod), 5),
      multiTimeframe: rsiMtf,
    },

    kdj: lastK
      ? {
          k: num(lastK.k, 4),
          d: num(lastK.d, 4),
          j: num(lastK.j, 4),
          kPrev: prevK ? num(prevK.k, 4) : null,
          dPrev: prevK ? num(prevK.d, 4) : null,
        }
      : null,

    levels: {
      // Pivôs sobre o último candle FECHADO do timeframe atual.
      pivot: prevCandle ? mapNums(pivotPoints(prevCandle)) : null,
      swingHighs: swings.highs.map((s) => num(s.price)),
      swingLows: swings.lows.map((s) => num(s.price)),
      range20: mapNums(rangeExtremes(candles, 20)),
      range60: mapNums(rangeExtremes(candles, 60)),
      range200: mapNums(rangeExtremes(candles, 200)),
    },

    volume: {
      lastBar: num(lastCandle.volume, 6),
      avg20: num(avgVol20, 6),
      ratioToAvg20: avgVol20 ? num(lastCandle.volume / avgVol20, 4) : null,
    },

    derivatives: {
      fundingRatePct: num(funding?.ratePct ?? null, 6),
      markPrice: num(funding?.markPrice ?? null),
      openInterestUsd: num(oi?.oiUsd ?? null, 6),
      openInterestChangePct24h: num(oi?.changePct24h ?? null, 4),

      // Fluxo agregado — os mesmos números dos painéis embaixo do preço.
      cvdSpot: cvdFlow(spotDelta, candleTimes),
      openInterest: oiFlow(aggOi, candleTimes),
      funding: fundingFlow(fundingSrc, oiWeights, candleTimes),
    },

    // Leitura ICT / Smart Money — mesmo objeto que o gráfico desenha.
    ict: ict && {
      bias: ict.structure.bias,
      lastEvent: ict.structure.last && {
        type: ict.structure.last.type,
        dir: ict.structure.last.dir,
        price: num(ict.structure.last.price),
        displacement: ict.structure.last.displacement,
      },
      range: ict.range && {
        high: num(ict.range.high),
        low: num(ict.range.low),
        equilibrium: num(ict.range.equilibrium),
        zone: ict.range.zone,
        pricePct: num(ict.range.pricePct, 4),
        legDir: ict.range.dir,
        oteTop: num(ict.range.ote.top),
        oteBottom: num(ict.range.ote.bottom),
        inOte: ict.range.inOte,
      },
      fvgs: ict.fvgs.slice(-6).map((g) => ({
        dir: g.dir, top: num(g.top), bottom: num(g.bottom), ce: num(g.ce), state: g.state,
      })),
      orderBlocks: ict.blocks.slice(-6).map((b) => ({
        dir: b.dir, kind: b.kind, top: num(b.top), bottom: num(b.bottom), state: b.state,
      })),
      liquidity: ict.pools.slice(0, 6).map((p) => ({
        kind: p.kind, price: num(p.price), touches: p.touches, swept: p.swept,
        distancePct: num(p.distancePct, 4),
      })),
      targetAbove: num(ict.targets.above?.price ?? null),
      targetBelow: num(ict.targets.below?.price ?? null),
      killzone: ict.activeKillzone?.id ?? null,
      po3: ict.po3 && {
        phase: ict.po3.phase,
        judasDir: ict.po3.judas?.dir ?? null,
        bias: ict.po3.bias,
      },
    },

    candles: candles.slice(-CANDLES_IN_PAYLOAD).map((c) => ({
      t: c.time,
      o: num(c.open),
      h: num(c.high),
      l: num(c.low),
      c: num(c.close),
      v: num(c.volume, 6),
    })),
  };
}

/** Arredonda todos os campos numéricos de um objeto simples (ou devolve null). */
function mapNums(obj) {
  if (!obj) return null;
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, num(value)]));
}
