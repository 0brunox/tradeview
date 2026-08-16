// Painel flutuante dos alertas de preço: formulário de criação + lista.
import { useState } from 'react';
import FloatingPanel from './FloatingPanel.jsx';
import { alertDir, fmtPrice, fmtTime, sortAlerts } from '../lib/alerts.js';
import { bareSymbol } from '../api/source.js';

const NOTIFY_LABEL = {
  granted: '🔔 notificações do sistema ligadas',
  denied: '🔕 notificações bloqueadas no browser',
  unsupported: '🔕 browser sem notificações',
};

function AlertRow({ alert, current, price, onSelect, onRemove, onRearm }) {
  const armed = alert.status === 'armed';
  const up = alert.dir === 'above';
  // Distância até o alvo, só faz sentido com o preço do ativo em mãos.
  const distPct = armed && price ? ((alert.price - price) / price) * 100 : null;

  return (
    <li className={`alert-item ${armed ? '' : 'alert-done'}`}>
      <button
        type="button"
        className={`alert-sym ${alert.symbol === current ? 'current' : ''}`}
        onClick={() => onSelect(alert.symbol)}
        title={alert.symbol === current ? 'Ativo já aberto' : `Abrir ${alert.symbol} no gráfico`}
      >
        {bareSymbol(alert.symbol)}
      </button>

      <span className="alert-cond">
        <span className={up ? 'up' : 'down'}>{up ? '▲' : '▼'}</span> {fmtPrice(alert.price)}
      </span>

      <span className="alert-state">
        {armed
          ? (distPct != null ? `${distPct > 0 ? '+' : ''}${distPct.toFixed(2)}%` : 'armado')
          : `✓ ${fmtTime(alert.triggeredAt)}`}
      </span>

      <span className="alert-acts">
        {!armed && (
          <button type="button" onClick={() => onRearm(alert.id)} title="Rearmar este alerta">↻</button>
        )}
        <button type="button" onClick={() => onRemove(alert.id)} title="Apagar alerta">×</button>
      </span>

      {alert.note && <span className="alert-note">{alert.note}</span>}
    </li>
  );
}

export default function AlertsPanel({
  alerts = [],
  symbol,
  price, // preço atual do ativo aberto (null enquanto carrega)
  prices = {}, // preço por símbolo, para as distâncias da lista
  position = 'top-left',
  xy = null,
  onMove,
  onClose,
  onCreate,
  onRemove,
  onRearm,
  onClearTriggered,
  onSelectSymbol,
  sound,
  onToggleSound,
  notifyState,
  onEnableNotify,
}) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  const target = Number(draft);
  const valid = draft !== '' && Number.isFinite(target) && target > 0;
  const dir = valid ? alertDir(target, price) : null;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    onCreate(target, note);
    setDraft('');
    setNote('');
  };

  const armed = alerts.filter((a) => a.status === 'armed').length;
  const done = alerts.length - armed;
  const sorted = sortAlerts(alerts, prices);

  return (
    <FloatingPanel
      className="alerts-panel"
      position={position}
      xy={xy}
      onMove={onMove}
      headClassName="alerts-head"
      head={(
        <>
          <span>🔔 Alertas {armed ? `· ${armed}` : ''}</span>
          <button type="button" className="ict-close" onClick={onClose} title="Fechar painel">×</button>
        </>
      )}
    >
      <form className="alert-form" onSubmit={submit}>
        <div className="alert-form-row">
          <input
            type="number"
            step="any"
            min="0"
            value={draft}
            placeholder={price ? fmtPrice(price) : 'preço'}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Preço do alerta"
          />
          <button type="submit" disabled={!valid}>Criar</button>
        </div>
        <input
          className="alert-note-input"
          type="text"
          value={note}
          placeholder="nota (opcional)"
          maxLength={80}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="alert-hint">
          {valid ? (
            <>
              {bareSymbol(symbol)} · dispara {dir === 'above' ? '▲ ao subir até' : '▼ ao cair até'}{' '}
              <b>{fmtPrice(target)}</b>
            </>
          ) : (
            <>
              Mercado{' '}
              <button
                type="button"
                className="alert-mkt"
                onClick={() => price && setDraft(String(price))}
                title="Usar o preço atual"
              >
                {fmtPrice(price)}
              </button>
              {' '}· ou use a ferramenta 🔔 e clique no gráfico
            </>
          )}
        </div>
      </form>

      {alerts.length === 0 ? (
        <div className="alert-empty">Nenhum alerta criado.</div>
      ) : (
        <ul className="alert-list">
          {sorted.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              current={symbol}
              price={a.symbol === symbol ? price : prices[a.symbol] ?? null}
              onSelect={onSelectSymbol}
              onRemove={onRemove}
              onRearm={onRearm}
            />
          ))}
        </ul>
      )}

      <div className="alert-foot">
        <label className="alert-chk" title="Bipe ao disparar">
          <input type="checkbox" checked={sound} onChange={(e) => onToggleSound(e.target.checked)} />
          <span>som</span>
        </label>

        {notifyState === 'default' ? (
          <button type="button" className="alert-link" onClick={onEnableNotify}>
            ativar notificações
          </button>
        ) : (
          <span className="alert-notify-state" title="Notificações do sistema avisam mesmo com a aba em segundo plano">
            {NOTIFY_LABEL[notifyState] ?? ''}
          </span>
        )}

        {done > 0 && (
          <button type="button" className="alert-link" onClick={onClearTriggered}>
            limpar {done} disparado{done > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </FloatingPanel>
  );
}
