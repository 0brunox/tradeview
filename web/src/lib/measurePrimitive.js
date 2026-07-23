// Lightweight Charts v5 primitive for the ruler / measure tool.
// Holds a single measurement { p1, p2, stats } in data coordinates and draws
// a shaded box + a label with the price/percent/bars/duration between points.

const UP = { fill: 'rgba(38,166,154,0.16)', line: '#26a69a' };
const DOWN = { fill: 'rgba(239,83,80,0.16)', line: '#ef5350' };

function fmtNum(v) {
  const abs = Math.abs(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: abs < 1 ? 6 : 2 });
}

export function formatDuration(sec) {
  let s = Math.abs(Math.round(sec));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && !d) parts.push(`${m}m`);
  return parts.join(' ') || '0m';
}

// Build the { p1, p2, stats } object a measurement needs.
export function makeMeasurement(p1, p2, candles) {
  const delta = p2.price - p1.price;
  const pct = p1.price ? (delta / p1.price) * 100 : 0;
  const lo = Math.min(p1.time, p2.time);
  const hi = Math.max(p1.time, p2.time);
  let bars = 0;
  for (const c of candles) if (c.time >= lo && c.time <= hi) bars += 1;
  bars = Math.max(0, bars - 1);
  return { p1, p2, stats: { delta, pct, bars, dur: formatDuration(hi - lo), up: delta >= 0 } };
}

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLabel(ctx, cx, yTop, yBottom, lines, bg) {
  ctx.font = '600 12px system-ui, -apple-system, sans-serif';
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
  const lh = 16;
  const height = lines.length * lh + 10;
  let y = yTop - height - 8;
  if (y < 4) y = yBottom + 8; // no room above → place below
  const x = cx - width / 2;

  ctx.fillStyle = bg;
  roundRect(ctx, x, y, width, height, 5);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, cx, y + 5 + i * lh + lh / 2));
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

class MeasureRenderer {
  constructor(primitive) {
    this._p = primitive;
  }

  draw(target) {
    const m = this._p.measure;
    if (!m) return;
    const { chart, series } = this._p;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ts = chart.timeScale();
      const x1 = ts.timeToCoordinate(m.p1.time);
      const x2 = ts.timeToCoordinate(m.p2.time);
      const y1 = series.priceToCoordinate(m.p1.price);
      const y2 = series.priceToCoordinate(m.p2.price);
      if (x1 == null || x2 == null || y1 == null || y2 == null) return;

      const col = m.stats.up ? UP : DOWN;
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      const cx = (left + right) / 2;

      ctx.fillStyle = col.fill;
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(left, top, right - left, bottom - top);

      // vertical direction line p1 → p2
      ctx.beginPath();
      ctx.moveTo(cx, y1);
      ctx.lineTo(cx, y2);
      ctx.stroke();

      const lines = [
        `${m.stats.up ? '+' : ''}${m.stats.pct.toFixed(2)}%`,
        `${m.stats.up ? '+' : ''}${fmtNum(m.stats.delta)}`,
        `${m.stats.bars} barras · ${m.stats.dur}`,
      ];
      drawLabel(ctx, cx, top, bottom, lines, col.line);
    });
  }
}

class MeasurePaneView {
  constructor(primitive) {
    this._renderer = new MeasureRenderer(primitive);
  }

  zOrder() {
    return 'top';
  }

  renderer() {
    return this._renderer;
  }
}

export class MeasurePrimitive {
  constructor({ chart, series }) {
    this.chart = chart;
    this.series = series;
    this.measure = null;
    this._views = [new MeasurePaneView(this)];
    this._requestUpdate = null;
  }

  attached(param) {
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._requestUpdate = null;
  }

  paneViews() {
    return this._views;
  }

  updateAllViews() {}

  setData(measure) {
    this.measure = measure || null;
    if (this._requestUpdate) this._requestUpdate();
  }
}
