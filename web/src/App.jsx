import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import Chart from './components/Chart.jsx';
import RsiPanel from './components/RsiPanel.jsx';
import Watchlist from './components/Watchlist.jsx';
import AiPanel from './components/AiPanel.jsx';
import IctPanel from './components/IctPanel.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';
import AlertToasts from './components/AlertToasts.jsx';
import { buildIctContext } from './indicators/ict/index.js';
import { fetchCandles } from './api/rest.js';
import { createLiveClient } from './api/ws.js';
import { loadState, saveState } from './lib/storage.js';
import { makeAlert, rearmAlert, triggerAlert, fmtPrice } from './lib/alerts.js';
import { useAlertWatcher } from './lib/useAlertWatcher.js';
import { askNotificationPermission, notificationState, playAlertBeep, showNotification } from './lib/notify.js';
import { bareSymbol } from './api/source.js';
import { API_BASE, IS_DIRECT } from './api/config.js';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '12h', '1d', '1w', '1M'];
const EMA_COLORS = ['#42a5f5', '#ff9800', '#ab47bc', '#26c6da', '#ec407a', '#9ccc65'];

function makeDefaults() {
  return {
    sma: { on: true, period: 20 },
    ema: {
      on: true,
      lines: [
        { id: 'ema-9', period: 9, color: '#42a5f5' },
        { id: 'ema-21', period: 21, color: '#ff9800' },
      ],
    },
    boll: { on: false, period: 20, mult: 2 },
    volume: { on: true },
    rsi: { on: true, period: 14 },
    macd: { on: false, fast: 12, slow: 26, signal: 9 },
    // `pos` é o canto de ancoragem do painel; `xy` guarda a posição livre depois
    // que o usuário arrasta a janela (null = ainda ancorada no canto).
    rsimtf: {
      on: false, period: 14, threshold: 50, overbought: 70, oversold: 30,
      pos: 'bottom-right', xy: null, showValues: true,
    },
    liqheat: { on: false },
    // Suíte ICT / Smart Money: `on` liga o conjunto, os demais escolhem as camadas.
    ict: {
      on: false,
      structure: true,
      fvg: true,
      ob: true,
      liquidity: true,
      range: true,
      sessions: true,
      panel: true,
      pos: 'top-right',
      xy: null,
    },
  };
}

// Merge stored indicator config over defaults, migrating the old single-EMA shape.
function mergeIndicators(stored) {
  const out = makeDefaults();
  if (!stored || typeof stored !== 'object') return out;
  for (const key of Object.keys(out)) {
    out[key] = { ...out[key], ...(stored[key] ?? {}) };
  }
  const se = stored.ema;
  if (se) {
    if (Array.isArray(se.lines)) out.ema.lines = se.lines;
    else if (typeof se.period === 'number') out.ema.lines = [{ id: 'ema-1', period: se.period, color: EMA_COLORS[0] }];
  }
  return out;
}

export default function App() {
  const persistedRef = useRef(null);
  if (persistedRef.current === null) persistedRef.current = loadState();
  const persisted = persistedRef.current;

  const [symbol, setSymbol] = useState(persisted.symbol ?? 'BTCUSDT');
  const [interval, setInterval] = useState(
    INTERVALS.includes(persisted.interval) ? persisted.interval : '1h',
  );
  const [candles, setCandles] = useState([]);
  // Ativo/timeframe a que os candles carregados pertencem. Sem isso não dá para
  // saber se `candles` já é do par selecionado ou ainda é do anterior.
  const [candlesOf, setCandlesOf] = useState({ symbol: null, interval: null });
  const [indicators, setIndicators] = useState(() => mergeIndicators(persisted.indicators));
  const [drawings, setDrawings] = useState(persisted.drawings ?? {});
  const [tool, setTool] = useState('none'); // 'none' | 'trend' | 'measure'
  const [favorites, setFavorites] = useState(persisted.favorites ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const [wlCollapsed, setWlCollapsed] = useState(persisted.wlCollapsed ?? false);
  const [aiOpen, setAiOpen] = useState(false);
  const [alerts, setAlerts] = useState(persisted.alerts ?? []);
  // Preferências do painel de alertas (aberto, posição arrastada, som).
  const [alertPrefs, setAlertPrefs] = useState(() => ({
    open: false, pos: 'top-left', xy: null, sound: true, ...(persisted.alertPrefs ?? {}),
  }));
  const [toasts, setToasts] = useState([]); // avisos na tela dos alertas disparados
  const [notifyPerm, setNotifyPerm] = useState(notificationState);
  const [liveCandle, setLiveCandle] = useState(null);
  const [loadStatus, setLoadStatus] = useState('loading');
  const [wsStatus, setWsStatus] = useState('connecting');
  const [dbMode, setDbMode] = useState('');
  const [error, setError] = useState('');

  const liveRef = useRef(null);
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);
  symbolRef.current = symbol;
  intervalRef.current = interval;

  // Ao trocar de par, o tick do WebSocket novo costuma chegar ANTES do histórico
  // REST — e como o candle do par novo tem o mesmo `time` do candle atual do par
  // antigo, uma fusão ingênua produziria um array híbrido (histórico de um ativo
  // com o preço de outro). Só tratamos os candles como utilizáveis quando eles
  // já são do par/timeframe selecionado.
  const dataReady = candlesOf.symbol === symbol && candlesOf.interval === interval;

  // Candles com a vela em formação já aplicada. O Chart faz essa fusão
  // internamente para atualizar as séries, mas a leitura ICT é compartilhada
  // com o painel — então ela é montada aqui, uma vez, e desce para os dois.
  const mergedCandles = useMemo(() => {
    if (!dataReady || !candles.length || !liveCandle) return candles;
    const { candle, symbol: s, interval: iv } = liveCandle;
    if (s !== symbol || iv !== interval) return candles;
    const last = candles[candles.length - 1];
    if (candle.time < last.time) return candles;
    return candle.time === last.time
      ? [...candles.slice(0, -1), candle]
      : [...candles, candle];
  }, [dataReady, candles, liveCandle, symbol, interval]);

  // O cálculo pesado é memorizado por candle fechado dentro de buildIctContext,
  // então recalcular a cada tick custa só a camada dependente do preço.
  const ictContext = useMemo(
    () => (indicators.ict.on && dataReady ? buildIctContext(mergedCandles, { symbol, interval }) : null),
    [indicators.ict.on, dataReady, mergedCandles, symbol, interval],
  );

  // Preço atual do ativo aberto — base para a direção dos alertas novos.
  const livePrice = mergedCandles.length && dataReady
    ? mergedCandles[mergedCandles.length - 1].close
    : null;

  // trend lines scoped per market + timeframe
  const drawKey = `${symbol}:${interval}`;
  const lines = useMemo(() => drawings[drawKey] ?? [], [drawings, drawKey]);

  const addLine = (line) => setDrawings((d) => ({ ...d, [drawKey]: [...(d[drawKey] ?? []), line] }));
  const deleteLine = (id) => setDrawings((d) => ({ ...d, [drawKey]: (d[drawKey] ?? []).filter((l) => l.id !== id) }));
  const clearLines = () => setDrawings((d) => ({ ...d, [drawKey]: [] }));

  // persist layout
  useEffect(() => {
    saveState({ symbol, interval, indicators, drawings, favorites, wlCollapsed, alerts, alertPrefs });
  }, [symbol, interval, indicators, drawings, favorites, wlCollapsed, alerts, alertPrefs]);

  // one-time: backend health (backend mode) + live socket
  useEffect(() => {
    if (!IS_DIRECT) {
      fetch(`${API_BASE}/api/health`).then((r) => r.json()).then((h) => setDbMode(h.db)).catch(() => {});
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

  // load historical candles
  useEffect(() => {
    let cancelled = false;
    setLoadStatus('loading');
    setError('');
    fetchCandles(symbol, interval, 800)
      .then((cs) => {
        if (cancelled) return;
        setCandles(cs);
        setCandlesOf({ symbol, interval });
        setLoadStatus('ready');
      })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoadStatus('error'); } });
    return () => { cancelled = true; };
  }, [symbol, interval]);

  // (re)subscribe live stream
  useEffect(() => {
    liveRef.current?.subscribe(symbol, interval);
  }, [symbol, interval]);

  const toggle = (key) => setIndicators((p) => ({ ...p, [key]: { ...p[key], on: !p[key].on } }));
  // Escolher um canto na barra também descarta a posição arrastada — senão a
  // troca no seletor não teria efeito visível enquanto `xy` estivesse setado.
  const setPeriod = (key, field, value) => setIndicators((p) => ({
    ...p,
    [key]: { ...p[key], [field]: value, ...(field === 'pos' ? { xy: null } : null) },
  }));
  const resetIndicators = () => setIndicators(makeDefaults());

  const addEma = () => setIndicators((p) => {
    const line = { id: `ema-${Date.now()}`, period: 50, color: EMA_COLORS[p.ema.lines.length % EMA_COLORS.length] };
    return { ...p, ema: { ...p.ema, on: true, lines: [...p.ema.lines, line] } };
  });
  const removeEma = (id) => setIndicators((p) => ({ ...p, ema: { ...p.ema, lines: p.ema.lines.filter((l) => l.id !== id) } }));
  const setEmaField = (id, field, value) => setIndicators((p) => ({
    ...p, ema: { ...p.ema, lines: p.ema.lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)) },
  }));

  const selectTool = (t) => setTool((cur) => (cur === t ? 'none' : t));
  const toggleFavorite = (sym) => setFavorites((f) => (f.includes(sym) ? f.filter((s) => s !== sym) : [...f, sym]));

  // ---- alertas de preço ----
  const soundOn = alertPrefs.sound;
  const alertPref = (key, value) => setAlertPrefs((p) => ({ ...p, [key]: value }));

  // Disparo: marca o alerta, mostra o aviso na tela, bipa e (se autorizado)
  // manda a notificação do sistema — que é o que serve com a aba em segundo plano.
  const handleTrigger = useCallback((alert, price) => {
    const at = Date.now();
    setAlerts((list) => list.map((a) => (a.id === alert.id ? { ...triggerAlert(a, price), triggeredAt: at } : a)));
    setToasts((t) => [...t, { ...alert, triggeredPrice: price, triggeredAt: at, uid: `${alert.id}:${at}` }].slice(-4));
    if (soundOn) playAlertBeep();
    showNotification(
      `🔔 ${bareSymbol(alert.symbol)} ${alert.dir === 'above' ? '▲' : '▼'} ${fmtPrice(alert.price)}`,
      `${alert.note ? `${alert.note} · ` : ''}preço em ${fmtPrice(price)}`,
      alert.id,
    );
  }, [soundOn]);

  const alertPrices = useAlertWatcher({ alerts, liveCandle, onTrigger: handleTrigger });

  const priceOf = (sym) => (sym === symbol ? livePrice : alertPrices[sym] ?? null);

  const addAlert = (price, note = '') => {
    if (!Number.isFinite(price) || price <= 0) return;
    setAlerts((list) => [makeAlert({ symbol, price, refPrice: livePrice, note }), ...list]);
    if (!alertPrefs.open) alertPref('open', true); // criado pelo gráfico: abre a lista como confirmação
  };
  const removeAlert = (id) => setAlerts((list) => list.filter((a) => a.id !== id));
  const rearm = (id) => setAlerts((list) => list.map((a) => (a.id === id ? rearmAlert(a, priceOf(a.symbol)) : a)));
  const clearTriggered = () => setAlerts((list) => list.filter((a) => a.status === 'armed'));
  const dismissToast = useCallback((uid) => setToasts((t) => t.filter((x) => x.uid !== uid)), []);
  const enableNotify = async () => setNotifyPerm(await askNotificationPermission());

  const armedCount = alerts.filter((a) => a.status === 'armed').length;
  const symbolAlerts = useMemo(() => alerts.filter((a) => a.symbol === symbol), [alerts, symbol]);

  const status = loadStatus === 'loading' ? 'loading' : loadStatus === 'error' ? 'error' : wsStatus;

  return (
    <div className="app">
      <Toolbar
        symbol={symbol}
        onSymbol={setSymbol}
        isFavorite={favorites.includes(symbol)}
        onToggleFavorite={() => toggleFavorite(symbol)}
        interval={interval}
        intervals={INTERVALS}
        onInterval={setInterval}
        indicators={indicators}
        onToggle={toggle}
        onPeriod={setPeriod}
        onResetIndicators={resetIndicators}
        onAddEma={addEma}
        onRemoveEma={removeEma}
        onEmaField={setEmaField}
        tool={tool}
        onSelectTool={selectTool}
        drawingCount={lines.length}
        onClearDrawings={clearLines}
        wlCollapsed={wlCollapsed}
        onToggleWatchlist={() => setWlCollapsed((v) => !v)}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((v) => !v)}
        alertsOpen={alertPrefs.open}
        onToggleAlerts={() => alertPref('open', !alertPrefs.open)}
        armedAlerts={armedCount}
        status={status}
        dbMode={dbMode}
      />

      <div className="body">
        <main className="stage">
          {error && (
            <div className="banner">
              Falha ao carregar dados: {error}. Verifique a conexão / backend.
            </div>
          )}
          {candles.length > 0 ? (
            <Chart
              candles={candles}
              indicators={indicators}
              liveCandle={dataReady ? liveCandle : null}
              symbol={symbol}
              interval={interval}
              ictContext={ictContext}
              tool={tool}
              lines={lines}
              onAddLine={addLine}
              onDeleteLine={deleteLine}
              alerts={dataReady ? symbolAlerts : []}
              onCreateAlert={addAlert}
            />
          ) : (
            !error && <div className="banner">Carregando {symbol} · {interval}…</div>
          )}

          {indicators.ict.on && indicators.ict.panel && (
            <IctPanel
              ict={ictContext}
              position={indicators.ict.pos}
              xy={indicators.ict.xy}
              onMove={(xy) => setPeriod('ict', 'xy', xy)}
              onClose={() => setPeriod('ict', 'panel', false)}
            />
          )}

          {indicators.rsimtf.on && (
            <RsiPanel
              symbol={symbol}
              period={indicators.rsimtf.period}
              threshold={indicators.rsimtf.threshold}
              overbought={indicators.rsimtf.overbought}
              oversold={indicators.rsimtf.oversold}
              position={indicators.rsimtf.pos}
              xy={indicators.rsimtf.xy}
              onMove={(xy) => setPeriod('rsimtf', 'xy', xy)}
              showValues={indicators.rsimtf.showValues}
              liveCandle={liveCandle}
            />
          )}

          {alertPrefs.open && (
            <AlertsPanel
              alerts={alerts}
              symbol={symbol}
              price={livePrice}
              prices={alertPrices}
              position={alertPrefs.pos}
              xy={alertPrefs.xy}
              onMove={(xy) => alertPref('xy', xy)}
              onClose={() => alertPref('open', false)}
              onCreate={addAlert}
              onRemove={removeAlert}
              onRearm={rearm}
              onClearTriggered={clearTriggered}
              onSelectSymbol={setSymbol}
              sound={soundOn}
              onToggleSound={(v) => alertPref('sound', v)}
              notifyState={notifyPerm}
              onEnableNotify={enableNotify}
            />
          )}

          <AlertToasts items={toasts} onDismiss={dismissToast} onSelect={setSymbol} />
        </main>

        <AiPanel
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          symbol={symbol}
          interval={interval}
          candles={dataReady ? candles : []}
          rsiPeriod={indicators.rsi.period}
        />

        <Watchlist
          favorites={favorites}
          current={symbol}
          onSelect={setSymbol}
          onRemove={toggleFavorite}
          collapsed={wlCollapsed}
        />
      </div>
    </div>
  );
}
