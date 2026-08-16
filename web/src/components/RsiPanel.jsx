import { useEffect, useRef, useState } from 'react';
import { fetchCandles } from '../api/rest.js';
import { rsi } from '../indicators/rsi.js';
import FloatingPanel from './FloatingPanel.jsx';

// Timeframes shown in the panel. `key` doubles as the Binance interval string
// (all of these are valid Binance klines intervals); `label` is the display text.
const PANEL_TFS = [
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '4h', label: '4h' },
  { key: '12h', label: '12h' },
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1M', label: '1M' },
];

const FETCH_LIMIT = 200; // enough history for Wilder's RSI to converge on every TF
const REFRESH_MS = 60000; // periodic refresh of the timeframes that have no live feed

// Last RSI value of a candle array, or null when there isn't enough history.
function lastRsi(candles, period) {
  if (!candles || candles.length <= period) return null;
  const series = rsi(candles, period);
  return series.length ? series[series.length - 1].value : null;
}

/**
 * Floating multi-timeframe RSI panel for the current symbol.
 * - Fetches candles for all 8 timeframes and recomputes on a periodic refresh.
 * - The timeframe matching the chart's live feed updates in real time via `liveCandle`.
 * - Dragging lives in FloatingPanel; `xy`/`onMove` only carry the position through.
 */
export default function RsiPanel({
  symbol,
  period = 14,
  threshold = 50,
  overbought = 70,
  oversold = 30,
  position = 'bottom-right',
  xy = null,
  onMove,
  showValues = true,
  liveCandle,
}) {
  const [rows, setRows] = useState({}); // { [tfKey]: number | null }
  const candlesRef = useRef({}); // { [tfKey]: candle[] } — kept for live recompute

  // Fetch every timeframe on symbol/period change, then refresh periodically.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const results = await Promise.all(
        PANEL_TFS.map((tf) =>
          fetchCandles(symbol, tf.key, FETCH_LIMIT)
            .then((cs) => ({ key: tf.key, cs }))
            .catch(() => ({ key: tf.key, cs: null })),
        ),
      );
      if (cancelled) return;
      const nextCandles = {};
      const nextRows = {};
      for (const { key, cs } of results) {
        nextCandles[key] = cs;
        nextRows[key] = lastRsi(cs, period);
      }
      candlesRef.current = nextCandles;
      setRows(nextRows);
    };

    setRows({}); // clear stale values while the new symbol loads
    candlesRef.current = {};
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol, period]);

  // Live tick: the WS only streams the chart's current interval, so at most one
  // row updates in real time; the rest ride the periodic refresh above.
  useEffect(() => {
    if (!liveCandle) return;
    const { candle, symbol: s, interval: iv } = liveCandle;
    if (s !== symbol) return;
    const arr = candlesRef.current[iv];
    if (!arr || !arr.length) return;

    const last = arr[arr.length - 1];
    let next;
    if (candle.time === last.time) next = arr.slice(0, -1).concat(candle);
    else if (candle.time > last.time) next = arr.concat(candle);
    else return; // stale tick

    candlesRef.current = { ...candlesRef.current, [iv]: next };
    setRows((r) => ({ ...r, [iv]: lastRsi(next, period) }));
  }, [liveCandle, symbol, period]);

  return (
    <FloatingPanel
      className="rsi-panel"
      position={position}
      xy={xy}
      onMove={onMove}
      headClassName="rsi-panel-head"
      head={(
        <>
          <span>RSI {period}</span>
          <span className="rsi-panel-sym">{symbol}</span>
        </>
      )}
    >
      <table className="rsi-table">
        <tbody>
          {PANEL_TFS.map((tf) => {
            const val = rows[tf.key];
            const has = val != null;
            const up = has && val > threshold;
            const ob = has && val >= overbought; // sobrecomprado
            const os = has && val <= oversold; // sobrevendido
            const baseCls = !has ? 'rsi-na' : up ? 'rsi-up' : 'rsi-down';
            const zoneCls = ob ? 'rsi-ob' : os ? 'rsi-os' : '';
            const status = up ? 'Alta' : 'Baixa';
            const text = !has ? '—' : showValues ? `${val.toFixed(2)} · ${status}` : status;
            return (
              <tr key={tf.key}>
                <td className="rsi-tf">{tf.label}</td>
                <td className={`rsi-val ${baseCls} ${zoneCls}`}>
                  <span className="rsi-text">{text}</span>
                  {ob && <span className="rsi-flag ob" title={`Sobrecomprado (RSI ≥ ${overbought})`}>SC</span>}
                  {os && <span className="rsi-flag os" title={`Sobrevendido (RSI ≤ ${oversold})`}>SV</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </FloatingPanel>
  );
}
