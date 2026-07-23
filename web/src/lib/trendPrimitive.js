// A Lightweight Charts v5 series primitive that draws trend lines.
// Each line is stored in DATA coordinates { p1:{time,price}, p2:{time,price} }
// and converted to pixels at draw time, so lines track pan / zoom automatically.

const COLOR = '#eab308'; // default
const HILITE = '#f59e0b'; // hovered
const PENDING = 'rgba(234,179,8,0.75)'; // line being drawn

class TrendRenderer {
  constructor(primitive) {
    this._p = primitive;
  }

  draw(target) {
    const { chart, series, lines, pending, hovered } = this._p;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ts = chart.timeScale();
      const toXY = (pt) => {
        const x = ts.timeToCoordinate(pt.time);
        const y = series.priceToCoordinate(pt.price);
        return x == null || y == null ? null : [x, y];
      };
      const segment = (a, b, color, width) => {
        const A = toXY(a);
        const B = toXY(b);
        if (!A || !B) return;
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(A[0], A[1]);
        ctx.lineTo(B[0], B[1]);
        ctx.stroke();
        ctx.fillStyle = color;
        for (const P of [A, B]) {
          ctx.beginPath();
          ctx.arc(P[0], P[1], 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      for (const ln of lines) {
        const on = ln.id === hovered;
        segment(ln.p1, ln.p2, on ? HILITE : COLOR, on ? 2.5 : 1.6);
      }
      if (pending) segment(pending.p1, pending.p2, PENDING, 1.4);
    });
  }
}

class TrendPaneView {
  constructor(primitive) {
    this._renderer = new TrendRenderer(primitive);
  }

  zOrder() {
    return 'top';
  }

  renderer() {
    return this._renderer;
  }
}

export class TrendLinesPrimitive {
  constructor({ chart, series }) {
    this.chart = chart;
    this.series = series;
    this.lines = [];
    this.pending = null;
    this.hovered = null;
    this._views = [new TrendPaneView(this)];
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

  updateAllViews() {
    /* the renderer reads live state each frame — nothing to cache */
  }

  setData(lines, pending, hovered) {
    this.lines = lines || [];
    this.pending = pending || null;
    this.hovered = hovered ?? null;
    if (this._requestUpdate) this._requestUpdate();
  }
}

// Distance (px) from point to segment, for hit-testing.
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Returns the id of the line nearest to (px,py) within `tol` pixels, or null.
export function nearestLine(chart, series, lines, px, py, tol = 6) {
  const ts = chart.timeScale();
  let bestId = null;
  let bestDist = tol;
  for (const ln of lines) {
    const x1 = ts.timeToCoordinate(ln.p1.time);
    const y1 = series.priceToCoordinate(ln.p1.price);
    const x2 = ts.timeToCoordinate(ln.p2.time);
    const y2 = series.priceToCoordinate(ln.p2.price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
    const d = distToSegment(px, py, x1, y1, x2, y2);
    if (d <= bestDist) {
      bestDist = d;
      bestId = ln.id;
    }
  }
  return bestId;
}
