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
  symbol, onSymbol,
  interval, intervals, onInterval,
  indicators, onToggle, onPeriod, onResetIndicators,
  drawMode, onToggleDraw, onClearDrawings, drawingCount,
  status, dbMode,
}) {
  const [showSettings, setShowSettings] = useState(false);
  const i = indicators;

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <div className="brand">📈 TradeView</div>

        <SymbolSearch value={symbol} onChange={onSymbol} />

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
            className={`tf ${drawMode ? 'tf-on' : ''}`}
            onClick={onToggleDraw}
            title="Linha de tendência: clique dois pontos. Fora do modo, clique numa linha para apagá-la."
          >
            ✏ Linha
          </button>
          <button
            type="button"
            className="tf"
            onClick={onClearDrawings}
            disabled={!drawingCount}
            title="Limpar desenhos deste ativo/timeframe"
          >
            🗑{drawingCount ? ` ${drawingCount}` : ''}
          </button>
        </div>

        <div className="spacer" />

        {dbMode && <span className="db-badge" title="Estado do backend">db: {dbMode}</span>}
        <span className={`status status-${status}`}>
          <span className="dot" /> {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      <div className="toolbar-row indicators">
        <Chip active={i.sma.on} onClick={() => onToggle('sma')} title="Média Móvel Simples">SMA {i.sma.period}</Chip>
        <Chip active={i.ema.on} onClick={() => onToggle('ema')} title="Média Móvel Exponencial">EMA {i.ema.period}</Chip>
        <Chip active={i.boll.on} onClick={() => onToggle('boll')} title="Bandas de Bollinger">BB {i.boll.period},{i.boll.mult}</Chip>
        <Chip active={i.volume.on} onClick={() => onToggle('volume')} title="Volume">Volume</Chip>
        <Chip active={i.rsi.on} onClick={() => onToggle('rsi')} title="Índice de Força Relativa">RSI {i.rsi.period}</Chip>
        <Chip active={i.macd.on} onClick={() => onToggle('macd')} title="MACD">MACD</Chip>

        <button
          type="button"
          className={`chip gear ${showSettings ? 'chip-on' : ''}`}
          onClick={() => setShowSettings((v) => !v)}
          title="Ajustar períodos"
        >
          ⚙
        </button>
      </div>

      {showSettings && (
        <div className="settings">
          <Num label="SMA" value={i.sma.period} min={2} max={400} onChange={(v) => onPeriod('sma', 'period', v)} />
          <Num label="EMA" value={i.ema.period} min={2} max={400} onChange={(v) => onPeriod('ema', 'period', v)} />
          <Num label="BB per." value={i.boll.period} min={2} max={400} onChange={(v) => onPeriod('boll', 'period', v)} />
          <Num label="BB mult." value={i.boll.mult} min={0.5} max={5} step={0.5} onChange={(v) => onPeriod('boll', 'mult', v)} />
          <Num label="RSI" value={i.rsi.period} min={2} max={100} onChange={(v) => onPeriod('rsi', 'period', v)} />
          <Num label="MACD rápida" value={i.macd.fast} min={2} max={100} onChange={(v) => onPeriod('macd', 'fast', v)} />
          <Num label="MACD lenta" value={i.macd.slow} min={2} max={200} onChange={(v) => onPeriod('macd', 'slow', v)} />
          <Num label="MACD sinal" value={i.macd.signal} min={2} max={100} onChange={(v) => onPeriod('macd', 'signal', v)} />
          <button type="button" className="reset-btn" onClick={onResetIndicators} title="Restaurar indicadores padrão">
            ↺ Restaurar padrões
          </button>
        </div>
      )}
    </header>
  );
}
