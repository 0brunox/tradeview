// Rótulo no canto superior esquerdo de um painel (pane primitive da v5).
// Os painéis de fluxo são três séries parecidas empilhadas sob o preço — sem um
// título em cada um não dá para saber qual é qual, e a lib não tem esse recurso
// pronto: o jeito dela é desenhar no canvas do próprio painel.

class TitleRenderer {
  constructor(primitive) {
    this._p = primitive;
  }

  draw(target) {
    const { title, value, color } = this._p;
    if (!title) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.textBaseline = 'top';
      const x = 8;
      const y = 5;
      ctx.fillStyle = '#787b86';
      ctx.fillText(title, x, y);
      if (value) {
        ctx.fillStyle = color ?? '#b2b5be';
        ctx.fillText(value, x + ctx.measureText(`${title} `).width, y);
      }
      ctx.restore();
    });
  }
}

class TitlePaneView {
  constructor(primitive) {
    this._renderer = new TitleRenderer(primitive);
  }

  zOrder() {
    return 'top'; // acima das séries do painel
  }

  renderer() {
    return this._renderer;
  }
}

export class PaneTitlePrimitive {
  constructor(title = '') {
    this.title = title;
    this.value = '';
    this.color = null;
    this._views = [new TitlePaneView(this)];
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
    /* o renderer lê o estado atual a cada frame */
  }

  setText(title, value = '', color = null) {
    this.title = title;
    this.value = value;
    this.color = color;
    if (this._requestUpdate) this._requestUpdate();
  }
}
