import { useState } from 'react';
import SymbolSearch from './SymbolSearch.jsx';

const STATUS_LABEL = {
  connecting: 'conectando',
  open: 'ao vivo',
  closed: 'reconectando',
  loading: 'carregando',
  error: 'erro',
};

function Chip({ active, onClick, children, title }) {
  return (
    <button type="button" className={`chip ${active ? 'chip-on' : ''}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function Num({ label, value, min, max, step, onChange }) {
  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function Toolbar({
  symbol, onSymbol, isFavorite, onToggleFavorite,
  interval, intervals, onInterval,
  indicators, onToggle, onPeriod, onResetIndicators,
  onAddEma, onRemoveEma, onEmaField,
  tool, onSelectTool,
  drawingCount, onClearDrawings,
  wlCollapsed, onToggleWatchlist,
  aiOpen, onToggleAi,
  status, dbMode,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const i = indicators;

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <div className="brand">📈 ObrunoX Trade</div>

        <SymbolSearch value={symbol} onChange={onSymbol} />
        <button
          type="button"
          className={`star ${isFavorite ? 'star-on' : ''}`}
          onClick={onToggleFavorite}
          title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          {isFavorite ? '★' : '☆'}
        </button>

        <div className="tf-group">
          {intervals.map((tf) => (
            <button
              key={tf}
              type="button"
              className={`tf ${tf === interval ? 'tf-on' : ''}`}
              onClick={() => onInterval(tf)}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="tf-group draw-group">
          <button
            type="button"
            className={`tf ${tool === 'trend' ? 'tf-on' : ''}`}
            onClick={() => onSelectTool('trend')}
            title="Linha de tendência: clique dois pontos. Fora do modo, clique numa linha para apagá-la."
          >
            ✏ Linha
          </button>
          <button
            type="button"
            className={`tf ${tool === 'measure' ? 'tf-on' : ''}`}
            onClick={() => onSelectTool('measure')}
            title="Régua: clique dois pontos para medir variação, barras e tempo."
          >
            📏 Régua
          </button>
          <button
            type="button"
            className="tf"
            onClick={onClearDrawings}
            disabled={!drawingCount}
            title="Limpar linhas deste ativo/timeframe"
          >
            🗑{drawingCount ? ` ${drawingCount}` : ''}
          </button>
        </div>

        <div className="spacer" />

        <button
          type="button"
          className={`tf ai-toggle ${aiOpen ? 'tf-on' : ''}`}
          onClick={onToggleAi}
          title="Relatório de análise técnica gerado por IA para o ativo/timeframe atual"
        >
          🤖 Análise IA
        </button>

        <button
          type="button"
          className={`tf ${!wlCollapsed ? 'tf-on' : ''}`}
          onClick={onToggleWatchlist}
          title="Mostrar/ocultar favoritos"
        >
          ⭐ Favoritos
        </button>

        {dbMode && <span className="db-badge" title="Estado do backend">db: {dbMode}</span>}
        <span className={`status status-${status}`}>
          <span className="dot" /> {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      <div className="toolbar-row indicators">
        <Chip active={i.sma.on} onClick={() => onToggle('sma')} title="Média Móvel Simples">SMA {i.sma.period}</Chip>
        <Chip active={i.ema.on} onClick={() => onToggle('ema')} title="Médias Móveis Exponenciais">EMA ({i.ema.lines.length})</Chip>
        <Chip active={i.boll.on} onClick={() => onToggle('boll')} title="Bandas de Bollinger">BB {i.boll.period},{i.boll.mult}</Chip>
        <Chip active={i.volume.on} onClick={() => onToggle('volume')} title="Volume">Volume</Chip>
        <Chip active={i.rsi.on} onClick={() => onToggle('rsi')} title="Índice de Força Relativa">RSI {i.rsi.period}</Chip>
        <Chip active={i.macd.on} onClick={() => onToggle('macd')} title="MACD">MACD</Chip>
        <Chip active={i.rsimtf.on} onClick={() => onToggle('rsimtf')} title="Painel RSI multi-timeframe">RSI MTF</Chip>
        <Chip active={i.liqheat.on} onClick={() => onToggle('liqheat')} title="Liquidation Heatmap (estimado via Open Interest de futuros — Binance perp)">🔥 Liq</Chip>

        <button
          type="button"
          className={`chip gear ${showSettings ? 'chip-on' : ''}`}
          onClick={() => setShowSettings((v) => !v)}
          title="Ajustar indicadores"
        >
          ⚙
        </button>
      </div>

      {showSettings && (
        <div className="settings">
          <Num label="SMA" value={i.sma.period} min={2} max={400} onChange={(v) => onPeriod('sma', 'period', v)} />

          <div className="ema-manager">
            <div className="ema-title">EMAs</div>
            {i.ema.lines.map((l) => (
              <div className="ema-row" key={l.id}>
                <input
                  type="color"
                  value={l.color}
                  onChange={(e) => onEmaField(l.id, 'color', e.target.value)}
                  title="Cor"
                />
                <input
                  type="number"
                  className="ema-period"
                  value={l.period}
                  min={2}
                  max={400}
                  onChange={(e) => onEmaField(l.id, 'period', Number(e.target.value))}
                />
                <button
                  type="button"
                  className="ema-del"
                  onClick={() => onRemoveEma(l.id)}
                  title="Remover EMA"
                  disabled={i.ema.lines.length <= 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="ema-add" onClick={onAddEma}>+ EMA</button>
          </div>

          <Num label="BB per." value={i.boll.period} min={2} max={400} onChange={(v) => onPeriod('boll', 'period', v)} />
          <Num label="BB mult." value={i.boll.mult} min={0.5} max={5} step={0.5} onChange={(v) => onPeriod('boll', 'mult', v)} />
          <Num label="RSI" value={i.rsi.period} min={2} max={100} onChange={(v) => onPeriod('rsi', 'period', v)} />
          <Num label="MACD rápida" value={i.macd.fast} min={2} max={100} onChange={(v) => onPeriod('macd', 'fast', v)} />
          <Num label="MACD lenta" value={i.macd.slow} min={2} max={200} onChange={(v) => onPeriod('macd', 'slow', v)} />
          <Num label="MACD sinal" value={i.macd.signal} min={2} max={100} onChange={(v) => onPeriod('macd', 'signal', v)} />

          <Num label="RSI MTF per." value={i.rsimtf.period} min={2} max={100} onChange={(v) => onPeriod('rsimtf', 'period', v)} />
          <Num label="MTF limiar" value={i.rsimtf.threshold} min={1} max={99} step={0.5} onChange={(v) => onPeriod('rsimtf', 'threshold', v)} />
          <Num label="MTF sobrecompra" value={i.rsimtf.overbought} min={50} max={100} step={0.5} onChange={(v) => onPeriod('rsimtf', 'overbought', v)} />
          <Num label="MTF sobrevenda" value={i.rsimtf.oversold} min={0} max={50} step={0.5} onChange={(v) => onPeriod('rsimtf', 'oversold', v)} />
          <label className="num">
            <span>MTF posição</span>
            <select value={i.rsimtf.pos} onChange={(e) => onPeriod('rsimtf', 'pos', e.target.value)}>
              <option value="top-left">Sup. esquerda</option>
              <option value="top-right">Sup. direita</option>
              <option value="bottom-left">Inf. esquerda</option>
              <option value="bottom-right">Inf. direita</option>
            </select>
          </label>
          <label className="num chk">
            <span>MTF valores</span>
            <input
              type="checkbox"
              checked={i.rsimtf.showValues}
              onChange={(e) => onPeriod('rsimtf', 'showValues', e.target.checked)}
            />
          </label>

          <button type="button" className="reset-btn" onClick={onResetIndicators} title="Restaurar indicadores padrão">
            ↺ Restaurar padrões
          </button>
        </div>
      )}
    </header>
  );
}
