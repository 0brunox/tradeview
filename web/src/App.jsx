import { useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import Chart from './components/Chart.jsx';
import { fetchCandles } from './api/rest.js';
import { createLiveClient } from './api/ws.js';
import { loadState, saveState } from './lib/storage.js';
import { API_BASE, IS_DIRECT } from './api/config.js';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

const DEFAULT_INDICATORS = {
  sma: { on: true, period: 20 },
  ema: { on: true, period: 21 },
  boll: { on: false, period: 20, mult: 2 },
  volume: { on: true },
  rsi: { on: true, period: 14 },
  macd: { on: false, fast: 12, slow: 26, signal: 9 },
};

// Merge stored indicator config over defaults so new indicators/fields added
// later still get sensible values.
function mergeIndicators(stored) {
  if (!stored || typeof stored !== 'object') return DEFAULT_INDICATORS;
  const out = {};
  for (const key of Object.keys(DEFAULT_INDICATORS)) {
    out[key] = { ...DEFAULT_INDICATORS[key], ...(stored[key] ?? {}) };
  }
  return out;
}

export default function App() {
  // load persisted layout once
  const persistedRef = useRef(null);
  if (persistedRef.current === null) persistedRef.current = loadState();
  const persisted = persistedRef.current;

  const [symbol, setSymbol] = useState(persisted.symbol ?? 'BTCUSDT');
  const [interval, setInterval] = useState(
    INTERVALS.includes(persisted.interval) ? persisted.interval : '1h',
  );
  const [candles, setCandles] = useState([]);
  const [indicators, setIndicators] = useState(() => mergeIndicators(persisted.indicators));
  const [drawings, setDrawings] = useState(persisted.drawings ?? {}); // { "SYMBOL:tf": [line] }
  const [drawMode, setDrawMode] = useState(false);
  const [liveCandle, setLiveCandle] = useState(null);
  const [loadStatus, setLoadStatus] = useState('loading'); // loading | ready | error
  const [wsStatus, setWsStatus] = useState('connecting');
  const [dbMode, setDbMode] = useState('');
  const [error, setError] = useState('');

  const liveRef = useRef(null);
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  symbolRef.current = symbol;
  intervalRef.current = interval;

  // trend lines are scoped per market + timeframe
  const drawKey = `${symbol}:${interval}`;
  const lines = useMemo(() => drawings[drawKey] ?? [], [drawings, drawKey]);

  const addLine = (line) =>
    setDrawings((d) => ({ ...d, [drawKey]: [...(d[drawKey] ?? []), line] }));
  const deleteLine = (id) =>
    setDrawings((d) => ({ ...d, [drawKey]: (d[drawKey] ?? []).filter((l) => l.id !== id) }));
  const clearLines = () => setDrawings((d) => ({ ...d, [drawKey]: [] }));

  // persist layout whenever it changes
  useEffect(() => {
    saveState({ symbol, interval, indicators, drawings });
  }, [symbol, interval, indicators, drawings]);

  // one-time: backend health (backend mode only) + the live socket
  useEffect(() => {
    if (!IS_DIRECT) {
      fetch(`${API_BASE}/api/health`)
        .then((r) => r.json())
        .then((h) => setDbMode(h.db))
        .catch(() => {});
    }

    const client = createLiveClient({
      onStatus: setWsStatus,
      onCandle: (candle, sym, iv) => {
        if (sym === symbolRef.current && iv === intervalRef.current) {
          setLiveCandle({ candle, symbol: sym, interval: iv });
        }
      },
    });
    liveRef.current = client;
    return () => client.close();
  }, []);

  // load historical candles on symbol / interval change
  useEffect(() => {
    let cancelled = false;
    setLoadStatus('loading');
    setError('');
    fetchCandles(symbol, interval, 800)
      .then((cs) => {
        if (cancelled) return;
        setCandles(cs);
        setLoadStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoadStatus('error');
      });
    return () => { cancelled = true; };
  }, [symbol, interval]);

  // (re)subscribe the live stream on symbol / interval change
  useEffect(() => {
    liveRef.current?.subscribe(symbol, interval);
  }, [symbol, interval]);

  const toggle = (key) =>
    setIndicators((prev) => ({ ...prev, [key]: { ...prev[key], on: !prev[key].on } }));

  const setPeriod = (key, field, value) =>
    setIndicators((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const resetIndicators = () => setIndicators(DEFAULT_INDICATORS);

  const status = loadStatus === 'loading' ? 'loading' : loadStatus === 'error' ? 'error' : wsStatus;

  return (
    <div className="app">
      <Toolbar
        symbol={symbol}
        onSymbol={setSymbol}
        interval={interval}
        intervals={INTERVALS}
        onInterval={setInterval}
        indicators={indicators}
        onToggle={toggle}
        onPeriod={setPeriod}
        onResetIndicators={resetIndicators}
        drawMode={drawMode}
        onToggleDraw={() => setDrawMode((v) => !v)}
        onClearDrawings={clearLines}
        drawingCount={lines.length}
        status={status}
        dbMode={dbMode}
      />

      <main className="stage">
        {error && (
          <div className="banner">
            Falha ao carregar dados: {error}. Verifique se o backend está no ar em {API_BASE}.
          </div>
        )}
        {candles.length > 0 ? (
          <Chart
            candles={candles}
            indicators={indicators}
            liveCandle={liveCandle}
            symbol={symbol}
            interval={interval}
            drawMode={drawMode}
            lines={lines}
            onAddLine={addLine}
            onDeleteLine={deleteLine}
          />
        ) : (
          !error && <div className="banner">Carregando {symbol} · {interval}…</div>
        )}
      </main>
    </div>
  );
}
