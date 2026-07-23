import { useEffect, useState } from 'react';
import { fetchTickers } from '../api/rest.js';
import { bareSymbol } from '../api/source.js';

function fmtPrice(p) {
  if (p == null || Number.isNaN(p)) return '—';
  return p.toLocaleString('en-US', { maximumFractionDigits: p < 1 ? 6 : 2 });
}

export default function Watchlist({ favorites, current, onSelect, onRemove, collapsed }) {
  const [tickers, setTickers] = useState({}); // symbol -> { price, changePct }

  useEffect(() => {
    if (collapsed || favorites.length === 0) return undefined;
    let alive = true;
    const load = () => {
      fetchTickers(favorites).then((rows) => {
        if (!alive) return;
        const map = {};
        for (const r of rows) map[r.symbol] = r;
        setTickers(map);
      });
    };
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [favorites, collapsed]);

  if (collapsed) return null;

  return (
    <aside className="watchlist">
      <div className="wl-head">Favoritos</div>
      {favorites.length === 0 ? (
        <div className="wl-empty">Adicione ativos com a ☆ ao lado do símbolo.</div>
      ) : (
        <ul className="wl-list">
          {favorites.map((sym) => {
            const t = tickers[sym];
            const up = t && t.changePct >= 0;
            return (
              <li
                key={sym}
                className={`wl-item ${sym === current ? 'current' : ''}`}
                onClick={() => onSelect(sym)}
              >
                <span className="wl-sym">
                  {bareSymbol(sym)}
                  {sym.includes(':') && <span className="src-tag">{sym.slice(0, sym.indexOf(':'))}</span>}
                </span>
                <span className="wl-right">
                  <span className="wl-price">{t ? fmtPrice(t.price) : '…'}</span>
                  {t && (
                    <span className={`wl-chg ${up ? 'up' : 'down'}`}>
                      {up ? '+' : ''}{t.changePct.toFixed(2)}%
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="wl-remove"
                  title="Remover dos favoritos"
                  onClick={(e) => { e.stopPropagation(); onRemove(sym); }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
