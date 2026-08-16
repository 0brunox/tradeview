// Avisos que aparecem no topo do gráfico quando um alerta dispara.
import { useEffect, useRef } from 'react';
import { bareSymbol } from '../api/source.js';
import { fmtPrice, fmtTime } from '../lib/alerts.js';

const LIFETIME_MS = 20000;

function Toast({ item, onDismiss, onSelect }) {
  // O App re-renderiza a cada tick do WebSocket; sem o ref, o callback novo a
  // cada render reiniciaria este timer e o aviso nunca sumiria sozinho.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const id = setTimeout(() => dismissRef.current(item.uid), LIFETIME_MS);
    return () => clearTimeout(id);
  }, [item.uid]);

  const up = item.dir === 'above';

  return (
    <div className={`toast ${up ? 'toast-up' : 'toast-down'}`}>
      <button
        type="button"
        className="toast-main"
        onClick={() => { onSelect(item.symbol); onDismiss(item.uid); }}
        title="Abrir este ativo no gráfico"
      >
        <span className="toast-title">
          🔔 {bareSymbol(item.symbol)} {up ? '▲' : '▼'} {fmtPrice(item.price)}
        </span>
        <span className="toast-sub">
          {item.note ? `${item.note} · ` : ''}
          preço {fmtPrice(item.triggeredPrice)} às {fmtTime(item.triggeredAt)}
        </span>
      </button>
      <button type="button" className="toast-close" onClick={() => onDismiss(item.uid)} title="Dispensar">
        ×
      </button>
    </div>
  );
}

export default function AlertToasts({ items = [], onDismiss, onSelect }) {
  if (!items.length) return null;
  return (
    <div className="alert-toasts">
      {items.map((it) => (
        <Toast key={it.uid} item={it} onDismiss={onDismiss} onSelect={onSelect} />
      ))}
    </div>
  );
}
