import { useEffect, useRef, useState } from 'react';
import { searchSymbols } from '../api/rest.js';
import { parseSymbol } from '../api/source.js';

export default function SymbolSearch({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // debounced search whenever the box is open and the query changes
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      searchSymbols(query, 24).then((r) => {
        if (!cancelled) {
          setResults(r);
          setActive(0);
        }
      });
    }, 160);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  // close on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function openDropdown() {
    setQuery('');
    setResults([]);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function pick(sym) {
    onChange(sym);
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) pick(r.symbol);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="symbol-search" ref={boxRef}>
      <button
        type="button"
        className="symbol-trigger"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        title="Buscar símbolo"
      >
        <span className="si-search">🔍</span>
        <span className="sym-name">{parseSymbol(value).symbol}</span>
        {value.includes(':') && <span className="src-tag">{value.slice(0, value.indexOf(':'))}</span>}
        <span className="sym-caret">▾</span>
      </button>

      {open && (
        <div className="symbol-pop">
          <input
            ref={inputRef}
            className="symbol-input"
            placeholder="Buscar (ex.: BTC, ETH, PEPE)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ul className="symbol-list">
            {results.length === 0 && <li className="symbol-empty">Nenhum resultado</li>}
            {results.map((r, idx) => (
              <li
                key={r.symbol}
                className={`symbol-item ${idx === active ? 'active' : ''} ${r.symbol === value ? 'current' : ''}`}
                onMouseEnter={() => setActive(idx)}
                onMouseDown={(e) => { e.preventDefault(); pick(r.symbol); }}
              >
                <span className="si-sym">
                  {parseSymbol(r.symbol).symbol}
                  {r.source === 'bybit' && <span className="src-tag">Bybit</span>}
                </span>
                <span className="si-pair">{r.baseAsset}/{r.quoteAsset}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
