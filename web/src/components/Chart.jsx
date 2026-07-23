import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import { sma } from '../indicators/sma.js';
import { ema } from '../indicators/ema.js';
import { rsi } from '../indicators/rsi.js';
import { macd } from '../indicators/macd.js';
import { bollinger } from '../indicators/bollinger.js';
import { TrendLinesPrimitive, nearestLine } from '../lib/trendPrimitive.js';
import { MeasurePrimitive, makeMeasurement } from '../lib/measurePrimitive.js';

const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const C = {
  up: '#26a69a',
  down: '#ef5350',
  sma: '#f0b90b',
  ema: '#42a5f5',
  bbMid: '#ab47bc',
  bbBand: '#5c6b7a',
  volUp: 'rgba(38,166,154,0.45)',
  volDown: 'rgba(239,83,80,0.45)',
  rsi: '#b39ddb',
  level: '#4a5160',
  macd: '#42a5f5',
  signal: '#ff7043',
};

const toBar = (c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
const toVol = (c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? C.volUp : C.volDown });

function chartOptions() {
  return {
    layout: {
      background: { type: ColorType.Solid, color: '#0e1016' },
      textColor: '#b2b5be',
      fontFamily: "'Inter', system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: '#151822' },
      horzLines: { color: '#151822' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
  };
}

const line = (extra) => ({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false, ...extra });

// Decimal places suited to a price magnitude — micro-caps (e.g. PEPE) need many.
function pricePrecision(p) {
  const v = Math.abs(p ?? 0);
  if (v === 0) return 2;
  if (v >= 100) return 2;
  if (v >= 1) return 4;
  if (v >= 0.01) return 5;
  if (v >= 0.0001) return 6;
  return 8;
}

function fmt(v, prec = 2) {
  return v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: prec });
}

function legendHtml(bar, symbol, interval) {
  if (!bar) return `<span class="lg-sym">${symbol}</span><span class="lg-tf">${interval}</span>`;
  const up = bar.close >= bar.open;
  const chg = bar.open ? ((bar.close - bar.open) / bar.open) * 100 : 0;
  const col = up ? C.up : C.down;
  const prec = pricePrecision(bar.close);
  return (
    `<span class="lg-sym">${symbol}</span><span class="lg-tf">${interval}</span>` +
    `<span>O<b>${fmt(bar.open, prec)}</b></span>` +
    `<span>H<b>${fmt(bar.high, prec)}</b></span>` +
    `<span>L<b>${fmt(bar.low, prec)}</b></span>` +
    `<span>C<b>${fmt(bar.close, prec)}</b></span>` +
    `<span style="color:${col}">${up ? '+' : ''}${chg.toFixed(2)}%</span>`
  );
}

export default function Chart({
  candles, indicators, liveCandle, symbol, interval,
  tool = 'none', lines = [], onAddLine, onDeleteLine,
}) {
  const containerRef = useRef(null);
  const legendRef = useRef(null);
  const apiRef = useRef(null); // holds chart + series + refreshIndicators() + trend
  const dataRef = useRef([]); // merged candle array (historical + live)
  const loadedRef = useRef(null); // identity of the last `candles` prop we reset from
  const metaRef = useRef({ symbol, interval });
  metaRef.current = { symbol, interval };

  // interaction state (synced from props each render)
  const toolRef = useRef(tool); // 'none' | 'trend' | 'measure'
  toolRef.current = tool;
  const linesRef = useRef(lines);
  linesRef.current = lines || [];
  const onAddLineRef = useRef(onAddLine);
  onAddLineRef.current = onAddLine;
  const onDeleteLineRef = useRef(onDeleteLine);
  onDeleteLineRef.current = onDeleteLine;
  const pendingStartRef = useRef(null); // first clicked point while drawing a trend line
  const pendingRef = useRef(null); // rubber-band trend line { p1, p2 }
  const hoveredRef = useRef(null); // id of hovered trend line
  const measureStartRef = useRef(null); // first clicked point of a measurement
  const measureRef = useRef(null); // current measurement { p1, p2, stats }

  // ---- build / rebuild (on new data load or indicator-set change) ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const isNewLoad = loadedRef.current !== candles;
    if (isNewLoad) {
      dataRef.current = Array.isArray(candles) ? candles.slice() : [];
      loadedRef.current = candles;
      // a measurement/pending line is tied to the previous market — drop it
      measureStartRef.current = null;
      measureRef.current = null;
      pendingStartRef.current = null;
      pendingRef.current = null;
    }
    const data = dataRef.current;

    const prevRange =
      !isNewLoad && apiRef.current
        ? apiRef.current.chart.timeScale().getVisibleLogicalRange()
        : null;

    if (apiRef.current) {
      try { apiRef.current.chart.remove(); } catch { /* ignore */ }
      apiRef.current = null;
    }

    const chart = createChart(container, {
      ...chartOptions(),
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
    });

    // keep the chart sized to its container
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) chart.resize(width, height);
    });
    ro.observe(container);

    // price pane (0)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderVisible: false,
      wickUpColor: C.up,
      wickDownColor: C.down,
    });
    candleSeries.setData(data.map(toBar));

    // adaptive price precision so micro-priced tokens don't render as 0.00
    const prec = pricePrecision(data.length ? data[data.length - 1].close : 1);
    candleSeries.applyOptions({ priceFormat: { type: 'price', precision: prec, minMove: 1 / 10 ** prec } });

    const api = { chart, candleSeries, volumeSeries: null, sma: null, emas: null, boll: null, rsi: null, macdSet: null };

    if (indicators.volume?.on) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(data.map(toVol));
      api.volumeSeries = vol;
    }
    if (indicators.sma?.on) {
      api.sma = chart.addSeries(LineSeries, line({ color: C.sma }));
    }
    if (indicators.ema?.on) {
      api.emas = indicators.ema.lines.map((l) => ({
        period: l.period,
        series: chart.addSeries(LineSeries, line({ color: l.color })),
      }));
    }
    if (indicators.boll?.on) {
      api.boll = {
        u: chart.addSeries(LineSeries, line({ color: C.bbBand, lineWidth: 1 })),
        m: chart.addSeries(LineSeries, line({ color: C.bbMid, lineWidth: 1, lineStyle: LineStyle.Dashed })),
        l: chart.addSeries(LineSeries, line({ color: C.bbBand, lineWidth: 1 })),
      };
    }

    // extra panes (indices assigned in order of activation)
    let pane = 1;
    if (indicators.rsi?.on) {
      const r = chart.addSeries(LineSeries, line({ color: C.rsi }), pane);
      r.createPriceLine({ price: 70, color: C.level, lineWidth: 1, lineStyle: LineStyle.Dashed });
      r.createPriceLine({ price: 30, color: C.level, lineWidth: 1, lineStyle: LineStyle.Dashed });
      api.rsi = r;
      pane += 1;
    }
    if (indicators.macd?.on) {
      api.macdSet = {
        hist: chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane),
        macdLine: chart.addSeries(LineSeries, line({ color: C.macd }), pane),
        signal: chart.addSeries(LineSeries, line({ color: C.signal }), pane),
      };
      pane += 1;
    }

    // recomputes every active indicator from an up-to-date candle array
    api.refreshIndicators = (d) => {
      if (api.sma) api.sma.setData(sma(d, indicators.sma.period));
      if (api.emas) for (const e of api.emas) e.series.setData(ema(d, e.period));
      if (api.boll) {
        const b = bollinger(d, indicators.boll.period, indicators.boll.mult);
        api.boll.u.setData(b.upper);
        api.boll.m.setData(b.middle);
        api.boll.l.setData(b.lower);
      }
      if (api.rsi) api.rsi.setData(rsi(d, indicators.rsi.period));
      if (api.macdSet) {
        const m = macd(d, indicators.macd.fast, indicators.macd.slow, indicators.macd.signal);
        api.macdSet.hist.setData(m.histogram);
        api.macdSet.macdLine.setData(m.macdLine);
        api.macdSet.signal.setData(m.signalLine);
      }
    };
    api.refreshIndicators(data);

    // pane sizing: price dominant
    const panes = chart.panes();
    if (panes[0]) panes[0].setStretchFactor(3);
    for (let i = 1; i < panes.length; i += 1) panes[i].setStretchFactor(1);

    apiRef.current = api;

    // viewport: keep it across indicator toggles; show the latest bars on load
    if (prevRange) {
      chart.timeScale().setVisibleLogicalRange(prevRange);
    } else {
      const n = data.length;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 3 });
    }

    // drawing primitives (pane 0): trend lines + measure box
    const trend = new TrendLinesPrimitive({ chart, series: candleSeries });
    candleSeries.attachPrimitive(trend);
    api.trend = trend;
    const measurePrim = new MeasurePrimitive({ chart, series: candleSeries });
    candleSeries.attachPrimitive(measurePrim);
    api.measure = measurePrim;
    const renderTrend = () => trend.setData(linesRef.current, pendingRef.current, hoveredRef.current);
    const renderMeasure = () => measurePrim.setData(measureRef.current);
    renderTrend();
    renderMeasure();

    // {time, price} at a crosshair/click param, or null if off a bar
    const pointAt = (param) => {
      if (!param.point) return null;
      const price = candleSeries.coordinateToPrice(param.point.y);
      const time = param.time ?? null;
      return price != null && time != null ? { time, price } : null;
    };

    // legend (updated on hover + on live ticks)
    const setLegend = (bar) => {
      if (legendRef.current) {
        legendRef.current.innerHTML = legendHtml(bar, metaRef.current.symbol, metaRef.current.interval);
      }
    };
    api.setLegend = setLegend;
    setLegend(data[data.length - 1]);

    chart.subscribeCrosshairMove((param) => {
      const bar = param?.seriesData?.get(candleSeries);
      setLegend(bar || dataRef.current[dataRef.current.length - 1]);

      const t = toolRef.current;
      if (t === 'trend') {
        const pt = pointAt(param);
        if (pendingStartRef.current && pt) {
          pendingRef.current = { p1: pendingStartRef.current, p2: pt };
          renderTrend();
        }
      } else if (t === 'measure') {
        const pt = pointAt(param);
        if (measureStartRef.current && pt) {
          measureRef.current = makeMeasurement(measureStartRef.current, pt, dataRef.current);
          renderMeasure();
        }
      } else {
        const id = param.point
          ? nearestLine(chart, candleSeries, linesRef.current, param.point.x, param.point.y, 6)
          : null;
        if (id !== hoveredRef.current) { hoveredRef.current = id; renderTrend(); }
      }
    });

    chart.subscribeClick((param) => {
      const t = toolRef.current;
      if (t === 'trend') {
        const pt = pointAt(param);
        if (!pt) return;
        if (!pendingStartRef.current) {
          pendingStartRef.current = pt;
          pendingRef.current = { p1: pt, p2: pt };
          renderTrend();
        } else {
          const created = { id: newId(), p1: pendingStartRef.current, p2: pt };
          pendingStartRef.current = null;
          pendingRef.current = null;
          renderTrend();
          onAddLineRef.current?.(created);
        }
      } else if (t === 'measure') {
        const pt = pointAt(param);
        if (!pt) return;
        if (!measureStartRef.current) {
          measureStartRef.current = pt;
          measureRef.current = makeMeasurement(pt, pt, dataRef.current);
        } else {
          measureRef.current = makeMeasurement(measureStartRef.current, pt, dataRef.current);
          measureStartRef.current = null;
        }
        renderMeasure();
      } else if (param.point) {
        const id = nearestLine(chart, candleSeries, linesRef.current, param.point.x, param.point.y, 6);
        if (id) onDeleteLineRef.current?.(id);
      }
    });

    return () => {
      ro.disconnect();
      try { chart.remove(); } catch { /* ignore */ }
      if (apiRef.current === api) apiRef.current = null;
    };
  }, [candles, indicators]);

  // ---- incremental live update (no rebuild) ----
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !liveCandle) return;
    const { candle, symbol: s, interval: iv } = liveCandle;
    if (s !== metaRef.current.symbol || iv !== metaRef.current.interval) return;

    const data = dataRef.current;
    const last = data[data.length - 1];
    if (last && candle.time < last.time) return; // stale tick
    if (last && candle.time === last.time) data[data.length - 1] = candle;
    else data.push(candle);

    api.candleSeries.update(toBar(candle));
    if (api.volumeSeries) api.volumeSeries.update(toVol(candle));
    api.refreshIndicators(data);
    api.setLegend(candle);
  }, [liveCandle]);

  // ---- push trend-line changes (add / delete / symbol switch) to the chart ----
  useEffect(() => {
    apiRef.current?.trend?.setData(lines || [], pendingRef.current, hoveredRef.current);
  }, [lines]);

  // ---- switching tools: clear the other tool's in-progress state + cursor ----
  useEffect(() => {
    const api = apiRef.current;
    if (tool !== 'trend') {
      pendingStartRef.current = null;
      pendingRef.current = null;
      api?.trend?.setData(linesRef.current, null, hoveredRef.current);
    }
    if (tool !== 'measure') {
      measureStartRef.current = null;
      measureRef.current = null;
      api?.measure?.setData(null);
    }
    if (containerRef.current) {
      containerRef.current.style.cursor = tool === 'none' ? '' : 'crosshair';
    }
  }, [tool]);

  return (
    <div className="chart-wrap">
      <div ref={legendRef} className="legend" />
      <div ref={containerRef} className="chart-container" />
    </div>
  );
}
