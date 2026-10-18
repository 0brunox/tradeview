// Encaixe das séries de fluxo (CVD spot, Open Interest, funding) no eixo de
// tempo do gráfico e a matemática de cada painel.
//
// Os dados externos chegam com granularidade própria (5m de OI, 8h de funding,
// o kline do mercado spot) — aqui eles viram uma série por candle, para os
// painéis ficarem alinhados com o preço mesmo em timeframes irregulares (1w/1M).

/**
 * Função que diz em qual candle cai um instante (ms) — busca binária sobre os
 * tempos de abertura. Um ponto depois da última abertura pertence ao candle em
 * formação; antes do primeiro candle, -1 (fica de fora).
 */
function makeBucketer(candleTimes) {
  const n = candleTimes.length;
  return (ms) => {
    const t = Math.floor(ms / 1000);
    if (n === 0 || t < candleTimes[0]) return -1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (candleTimes[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

/**
 * CVD spot em candles: a soma acumulada do delta de volume, ancorada em zero no
 * primeiro candle com dado. Open = acumulado antes do candle, close = depois.
 * O kline não guarda o caminho dentro da barra, então o corpo vai sem sombras —
 * a leitura é a mesma: corpo verde = taker comprador dominou a barra.
 * → [{ time, open, high, low, close }]
 */
export function cvdCandles(deltaRows, candleTimes) {
  if (!deltaRows?.length || !candleTimes?.length) return [];
  const at = makeBucketer(candleTimes);
  const sums = new Float64Array(candleTimes.length);
  const hit = new Uint8Array(candleTimes.length);
  for (const r of deltaRows) {
    const i = at(r.time);
    if (i < 0) continue;
    sums[i] += r.delta;
    hit[i] = 1;
  }

  // Fora do intervalo que tem dado não há CVD: antes do primeiro candle com
  // fluxo nada é desenhado, e depois do último também não — senão a série
  // arrastaria uma linha reta pelo resto do gráfico.
  const first = hit.indexOf(1);
  const lastHit = hit.lastIndexOf(1);
  if (first < 0) return [];

  const out = [];
  let cum = 0;
  for (let i = first; i <= lastHit; i += 1) {
    const open = cum;
    cum += sums[i];
    out.push({
      time: candleTimes[i],
      open,
      high: Math.max(open, cum),
      low: Math.min(open, cum),
      close: cum,
    });
  }
  return out;
}

/**
 * Open Interest em candles: cada barra abre onde a anterior fechou e varre o
 * máximo/mínimo do OI dentro do candle. Quando o histórico é mais grosso que o
 * timeframe (OI de 5m num gráfico de 1m), o candle sem ponto novo repete o
 * último valor — um doji, que é exatamente o que aconteceu com o OI ali.
 * → [{ time, open, high, low, close }]
 */
export function oiCandles(oiRows, candleTimes) {
  if (!oiRows?.length || !candleTimes?.length) return [];
  const at = makeBucketer(candleTimes);
  const buckets = new Map(); // índice do candle → { o, h, l, c }
  for (const r of oiRows) {
    const i = at(r.t);
    if (i < 0) continue;
    const b = buckets.get(i);
    if (!b) buckets.set(i, { o: r.v, h: r.v, l: r.v, c: r.v });
    else {
      b.h = Math.max(b.h, r.v);
      b.l = Math.min(b.l, r.v);
      b.c = r.v;
    }
  }

  const out = [];
  let prev = null;
  for (let i = 0; i < candleTimes.length; i += 1) {
    const b = buckets.get(i);
    if (!b) {
      if (prev == null) continue; // antes do início do histórico de OI
      out.push({ time: candleTimes[i], open: prev, high: prev, low: prev, close: prev });
      continue;
    }
    const open = prev == null ? b.o : prev;
    out.push({
      time: candleTimes[i],
      open,
      high: Math.max(open, b.h),
      low: Math.min(open, b.l),
      close: b.c,
    });
    prev = b.c;
  }
  return out;
}

/**
 * Funding agregado em %, ponderado pelo Open Interest de cada corretora — o
 * dinheiro posicionado é que decide quanto a taxa de cada uma vale na média.
 * A taxa de uma fonte vale em degrau até a próxima (é assim que ela é cobrada);
 * se uma fonte só começa no meio da janela, os pesos são renormalizados para as
 * que existem ali, senão o agregado abriria achatado.
 * → [{ time, value }] com value em % por período de 8h
 */
export function fundingSeries(series, weights, candleTimes) {
  const names = Object.keys(series ?? {}).filter((k) => series[k]?.length);
  if (names.length === 0 || !candleTimes?.length) return [];

  const n = candleTimes.length;
  const at = makeBucketer(candleTimes);
  const grids = names.map((name) => {
    const grid = new Array(n).fill(null);
    for (const r of series[name]) {
      const i = at(r.t);
      if (i >= 0) grid[i] = r.rate;
    }
    let last = null;
    for (let i = 0; i < n; i += 1) {
      if (grid[i] == null) grid[i] = last;
      else last = grid[i];
    }
    return grid;
  });

  const raw = names.map((name) => Math.max(0, Number(weights?.[name]) || 0));
  const total = raw.reduce((a, b) => a + b, 0);
  const share = total > 0 ? raw.map((w) => w / total) : names.map(() => 1 / names.length);

  const out = [];
  for (let i = 0; i < n; i += 1) {
    let acc = 0;
    let used = 0;
    for (let k = 0; k < grids.length; k += 1) {
      const v = grids[k][i];
      if (v == null) continue;
      acc += v * share[k];
      used += share[k];
    }
    if (used <= 0) continue;
    out.push({ time: candleTimes[i], value: (acc / used) * 100 });
  }
  return out;
}
