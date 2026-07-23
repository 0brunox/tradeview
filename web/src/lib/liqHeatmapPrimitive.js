// Lightweight Charts v5 primitive that paints an estimated liquidation heatmap
// as horizontal thermal bands behind the candles. Data is in price coordinates
// so the bands track pan / zoom automatically.

// Thermal ramp: low intensity → blue, mid → yellow, high → red-orange.
// Alpha grows with intensity so faint zones stay unobtrusive.
function heatColor(t) {
  let r;
  let g;
  let b;
  if (t < 0.5) {
    const k = t / 0.5;
    r = Math.round(30 + (245 - 30) * k);
    g = Math.round(90 + (215 - 90) * k);
    b = Math.round(210 - (210 - 55) * k);
  } else {
    const k = (t - 0.5) / 0.5;
    r = 245;
    g = Math.round(215 - (215 - 70) * k);
    b = Math.round(55 - 55 * k);
  }
  const a = 0.08 + 0.5 * t;
  return `rgba(${r},${g},${b},${a})`;
}

class HeatRenderer {
  constructor(primitive) {
    this._p = primitive;
  }

  draw(target) {
    const { chart, series, cells } = this._p;
    if (!cells || cells.length === 0) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = chart.timeScale().width();
      for (const c of cells) {
        const yTop = series.priceToCoordinate(c.priceHigh);
        const yBot = series.priceToCoordinate(c.priceLow);
        if (yTop == null || yBot == null) continue;
        const h = Math.max(1, yBot - yTop);
        ctx.fillStyle = heatColor(c.intensity);
        ctx.fillRect(0, yTop, width, h);
      }
    });
  }
}

class HeatPaneView {
  constructor(primitive) {
    this._renderer = new HeatRenderer(primitive);
  }

  zOrder() {
    return 'bottom'; // behind candles and other series
  }

  renderer() {
    return this._renderer;
  }
}

export class LiqHeatmapPrimitive {
  constructor({ chart, series }) {
    this.chart = chart;
    this.series = series;
    this.cells = [];
    this._views = [new HeatPaneView(this)];
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
    /* renderer reads live state each frame */
  }

  setData(heatmap) {
    this.cells = heatmap?.cells ?? [];
    if (this._requestUpdate) this._requestUpdate();
  }
}
