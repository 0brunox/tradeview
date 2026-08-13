// Lightweight Charts v5 primitive that draws the ICT / Smart Money reading.
//
// Two pane views with different z-order, because the layers mean different
// things: zones are *context* and belong behind the candles, while liquidity
// levels and structure labels are *annotations* and must stay readable on top.
//
// Everything is kept in data coordinates (time / price) and converted at draw
// time, so the whole overlay tracks pan and zoom for free — same approach as
// trendPrimitive.js and liqHeatmapPrimitive.js.

const COLORS = {
  fvgBull: { fill: 'rgba(38,166,154,0.13)', line: 'rgba(38,166,154,0.45)' },
  fvgBear: { fill: 'rgba(239,83,80,0.13)', line: 'rgba(239,83,80,0.45)' },
  obBull: { fill: 'rgba(38,166,154,0.10)', line: 'rgba(38,166,154,0.70)' },
  obBear: { fill: 'rgba(239,83,80,0.10)', line: 'rgba(239,83,80,0.70)' },
  premium: 'rgba(239,83,80,0.045)',
  discount: 'rgba(38,166,154,0.045)',
  equilibrium: 'rgba(178,181,190,0.55)',
  ote: { fill: 'rgba(240,185,11,0.10)', line: 'rgba(240,185,11,0.55)' },
  bsl: '#ef5350',
  ssl: '#26a69a',
  swept: 'rgba(120,126,140,0.75)',
  bos: '#4a9eff',
  choch: '#f0b90b',
  judas: '#ab47bc',
  text: '#d5d8e0',
  killzone: {
    asia: 'rgba(120,130,160,0.07)',
    london: 'rgba(66,165,245,0.07)',
    nyopen: 'rgba(240,185,11,0.075)',
    nyclose: 'rgba(171,71,188,0.07)',
  },
};

const FONT = "10px 'Inter', system-ui, sans-serif";
const LABEL_PAD = 3;

// Draws text with a dark plate behind it so labels stay legible over candles.
function tag(ctx, text, x, y, color) {
  ctx.font = FONT;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(14,16,22,0.72)';
  ctx.fillRect(x - LABEL_PAD, y - 9, w + LABEL_PAD * 2, 12);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

class ZonesRenderer {
  constructor(primitive) {
    this._p = primitive;
  }

  draw(target) {
    const { chart, series, ctx: ict, features } = this._p;
    if (!ict) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ts = chart.timeScale();
      const width = ts.width();
      const height = scope.mediaSize.height;
      const barSpacing = ts.options().barSpacing ?? 6;
      const xOf = (t) => ts.timeToCoordinate(t);
      const yOf = (p) => series.priceToCoordinate(p);

      // --- killzones: vertical bands across the whole pane -------------------
      if (features.sessions) {
        for (const band of ict.killzoneBands) {
          const x1 = xOf(band.from);
          const x2 = xOf(band.to);
          if (x1 == null || x2 == null) continue;
          ctx.fillStyle = COLORS.killzone[band.id] ?? COLORS.killzone.asia;
          ctx.fillRect(x1 - barSpacing / 2, 0, x2 - x1 + barSpacing, height);
        }
      }

      // --- premium / discount / OTE ------------------------------------------
      if (features.range && ict.range) {
        const r = ict.range;
        const yHigh = yOf(r.high);
        const yEq = yOf(r.equilibrium);
        const yLow = yOf(r.low);
        if (yHigh != null && yEq != null && yLow != null) {
          ctx.fillStyle = COLORS.premium;
          ctx.fillRect(0, yHigh, width, yEq - yHigh);
          ctx.fillStyle = COLORS.discount;
          ctx.fillRect(0, yEq, width, yLow - yEq);

          const yTop = yOf(r.ote.top);
          const yBot = yOf(r.ote.bottom);
          if (yTop != null && yBot != null) {
            ctx.fillStyle = COLORS.ote.fill;
            ctx.fillRect(0, yTop, width, yBot - yTop);
            ctx.strokeStyle = COLORS.ote.line;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(0.5, yTop + 0.5, width - 1, yBot - yTop - 1);
            ctx.setLineDash([]);
            tag(ctx, `OTE ${r.dir === 'bull' ? 'compra' : 'venda'}`, 6, yTop - 2, COLORS.ote.line);
          }
        }
      }

      // --- boxes: FVG then order blocks --------------------------------------
      const box = (zone, fill, line, label, dash) => {
        const x1 = xOf(zone.time);
        const yTop = yOf(zone.top);
        const yBot = yOf(zone.bottom);
        if (x1 == null || yTop == null || yBot == null) return;
        // A mitigated zone stops where it was filled; a live one runs to the edge.
        const endTime = zone.filledTime ?? zone.mitigatedTime;
        const x2 = endTime ? (xOf(endTime) ?? width) : width;
        const w = Math.max(2, x2 - x1);
        const h = Math.max(1, yBot - yTop);

        ctx.fillStyle = fill;
        ctx.fillRect(x1, yTop, w, h);
        if (line) {
          ctx.strokeStyle = line;
          ctx.lineWidth = 1;
          if (dash) ctx.setLineDash(dash);
          ctx.strokeRect(x1 + 0.5, yTop + 0.5, w - 1, h - 1);
          ctx.setLineDash([]);
        }
        if (label && h >= 11 && w > 34) tag(ctx, label, x1 + 4, yBot - 2, line || COLORS.text);
      };

      if (features.fvg) {
        for (const g of ict.fvgs) {
          const c = g.dir === 'bull' ? COLORS.fvgBull : COLORS.fvgBear;
          box(g, c.fill, c.line, g.state === 'partial' ? 'FVG ½' : 'FVG', [3, 3]);
        }
      }

      if (features.ob) {
        for (const b of ict.blocks) {
          const c = b.dir === 'bull' ? COLORS.obBull : COLORS.obBear;
          box(b, c.fill, c.line, b.kind === 'breaker' ? 'BRK' : 'OB', null);
        }
      }
    });
  }
}

class MarkersRenderer {
  constructor(primitive) {
    this._p = primitive;
  }

  draw(target) {
    const { chart, series, ctx: ict, features } = this._p;
    if (!ict) return;

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ts = chart.timeScale();
      const width = ts.width();
      const xOf = (t) => ts.timeToCoordinate(t);
      const yOf = (p) => series.priceToCoordinate(p);

      // --- equilibrium line --------------------------------------------------
      if (features.range && ict.range) {
        const y = yOf(ict.range.equilibrium);
        if (y != null) {
          ctx.strokeStyle = COLORS.equilibrium;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
          ctx.setLineDash([]);
          tag(ctx, 'EQ 50%', width - 52, y - 3, COLORS.equilibrium);
        }
      }

      // --- liquidity pools ---------------------------------------------------
      if (features.liquidity) {
        for (const pool of ict.pools) {
          const y = yOf(pool.price);
          if (y == null) continue;
          const x1 = xOf(pool.lastTime) ?? 0;
          const color = pool.swept ? COLORS.swept : pool.kind === 'BSL' ? COLORS.bsl : COLORS.ssl;

          ctx.strokeStyle = color;
          ctx.lineWidth = pool.touches > 1 ? 1.5 : 1;
          ctx.setLineDash(pool.swept ? [2, 3] : [6, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.max(0, x1), y);
          ctx.lineTo(width, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // "EQH ×3" reads better than "BSL" when the pool is a cluster.
          const eq = pool.touches > 1 ? (pool.kind === 'BSL' ? 'EQH' : 'EQL') : pool.kind;
          const label = `${eq}${pool.touches > 1 ? ` ×${pool.touches}` : ''}${pool.swept ? ' ✓' : ''}`;
          tag(ctx, label, width - 66, y - 3, color);
        }
      }

      // --- structure: BOS / CHoCH -------------------------------------------
      if (features.structure) {
        for (const ev of ict.structure.events) {
          const x = xOf(ev.time);
          const y = yOf(ev.price);
          if (x == null || y == null) continue;
          const color = ev.type === 'CHoCH' ? COLORS.choch : COLORS.bos;

          ctx.strokeStyle = color;
          ctx.lineWidth = ev.displacement ? 1.6 : 1;
          ctx.setLineDash([1, 2]);
          ctx.beginPath();
          ctx.moveTo(x - 26, y);
          ctx.lineTo(x + 8, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Displacement is what makes the break count for ICT — mark it.
          const label = `${ev.type}${ev.displacement ? ' ⚡' : ''}`;
          tag(ctx, label, x + 11, ev.dir === 'bull' ? y - 3 : y + 10, color);
        }
      }

      // --- judas swing -------------------------------------------------------
      if (features.sessions && ict.po3?.judas) {
        const j = ict.po3.judas;
        const x = xOf(j.time);
        const y = yOf(j.price);
        if (x != null && y != null) {
          ctx.fillStyle = COLORS.judas;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          tag(ctx, 'Judas', x + 6, j.dir === 'up' ? y - 3 : y + 11, COLORS.judas);
        }
      }
    });
  }
}

class PaneView {
  constructor(renderer, zOrder) {
    this._renderer = renderer;
    this._zOrder = zOrder;
  }

  zOrder() {
    return this._zOrder;
  }

  renderer() {
    return this._renderer;
  }
}

export class IctPrimitive {
  constructor({ chart, series }) {
    this.chart = chart;
    this.series = series;
    this.ctx = null;
    this.features = {};
    this._views = [
      new PaneView(new ZonesRenderer(this), 'bottom'),
      new PaneView(new MarkersRenderer(this), 'top'),
    ];
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
    /* renderers read live state each frame */
  }

  setData(ictContext, features) {
    this.ctx = ictContext;
    this.features = features ?? {};
    if (this._requestUpdate) this._requestUpdate();
  }
}
