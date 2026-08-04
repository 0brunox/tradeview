import { useEffect, useRef, useState } from 'react';
import { buildSnapshot } from '../lib/snapshot.js';
import { requestAnalysis } from '../api/ai.js';
import { parseMarkdown } from '../lib/markdown.js';

const STATUS_TEXT = {
  collecting: 'Coletando indicadores e dados de mercado…',
  streaming: 'Analisando…',
};

/** Spans → elementos React (negrito e código inline). */
function Spans({ spans }) {
  return spans.map((s, i) => {
    if (s.code) return <code key={i}>{s.text}</code>;
    if (s.bold) return <strong key={i}>{s.text}</strong>;
    return <span key={i}>{s.text}</span>;
  });
}

/** Blocos do parser de markdown → JSX. */
function Report({ text }) {
  const blocks = parseMarkdown(text);
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'heading': {
        const Tag = `h${Math.min(b.level + 1, 6)}`; // h1 do relatório vira h2 no painel
        return <Tag key={i} className={`ai-h ai-h${b.level}`}><Spans spans={b.spans} /></Tag>;
      }
      case 'list':
        return (
          <ul key={i} className="ai-list">
            {b.items.map((spans, j) => <li key={j}><Spans spans={spans} /></li>)}
          </ul>
        );
      case 'quote':
        return <blockquote key={i} className="ai-quote"><Spans spans={b.spans} /></blockquote>;
      default:
        return <p key={i} className="ai-p"><Spans spans={b.spans} /></p>;
    }
  });
}

/**
 * Painel lateral com o relatório de análise gerado por IA.
 * Um relatório por ativo+timeframe fica em cache enquanto a sessão dura; abrir
 * o painel (ou trocar de ativo com ele aberto) dispara a análise que falta.
 */
export default function AiPanel({ open, onClose, symbol, interval, candles, rsiPeriod = 14 }) {
  const [reports, setReports] = useState({}); // { [key]: { text, done, at } }
  const [status, setStatus] = useState('idle'); // idle | collecting | streaming | error
  const [error, setError] = useState('');

  const abortRef = useRef(null);
  const attemptedRef = useRef(new Set()); // evita re-disparo automático após falha
  const bodyRef = useRef(null);

  const key = `${symbol}:${interval}`;
  const report = reports[key];
  const busy = status === 'collecting' || status === 'streaming';

  // Um relatório interrompido no meio (painel fechado, troca de ativo) não serve
  // de cache: some com ele para a próxima abertura gerar um relatório inteiro.
  const dropIncomplete = () => {
    setReports((r) => {
      const next = {};
      for (const [k, v] of Object.entries(r)) {
        if (v.done) next[k] = v;
        else attemptedRef.current.delete(k);
      }
      return next;
    });
  };

  const run = async () => {
    abortRef.current?.abort();
    dropIncomplete();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    attemptedRef.current.add(key);

    setError('');
    setStatus('collecting');

    try {
      const snapshot = await buildSnapshot({
        fullSymbol: symbol,
        interval,
        candles,
        rsiPeriod,
      });
      if (ctrl.signal.aborted) return;

      setReports((r) => ({ ...r, [key]: { text: '', done: false, at: Date.now() } }));
      setStatus('streaming');

      await requestAnalysis(snapshot, {
        signal: ctrl.signal,
        onChunk: (chunk) =>
          setReports((r) => (r[key] ? { ...r, [key]: { ...r[key], text: r[key].text + chunk } } : r)),
      });

      if (ctrl.signal.aborted) return;
      setReports((r) => (r[key] ? { ...r, [key]: { ...r[key], done: true } } : r));
      setStatus('idle');
    } catch (err) {
      if (ctrl.signal.aborted || err.name === 'AbortError') return;
      setReports((r) => {
        const next = { ...r };
        delete next[key];
        return next;
      });
      setError(err.message);
      setStatus('error');
    }
  };

  const refresh = () => {
    attemptedRef.current.delete(key);
    setReports((r) => {
      const next = { ...r };
      delete next[key];
      return next;
    });
    run();
  };

  // Dispara a análise que falta ao abrir o painel ou ao trocar de ativo/timeframe.
  useEffect(() => {
    if (!open || busy) return;
    if (reports[key] || attemptedRef.current.has(key)) return;
    if (!candles || candles.length < 30) return;
    run();
    // `run` depende de symbol/interval/candles, todos cobertos pela key + open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, candles]);

  // Fechar o painel cancela qualquer análise em andamento.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus('idle');
      dropIncomplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Acompanha o texto que vai chegando, a menos que o usuário tenha rolado pra cima.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || status !== 'streaming') return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [report?.text, status]);

  if (!open) return null;

  return (
    <aside className="ai-panel">
      <header className="ai-head">
        <div className="ai-title">
          <span className="ai-badge">🤖 Análise IA</span>
          <span className="ai-sym">{symbol}</span>
          <span className="ai-tf">{interval}</span>
        </div>
        <div className="ai-actions">
          <button
            type="button"
            className="ai-btn"
            onClick={refresh}
            disabled={busy}
            title="Gerar uma nova análise com os dados atuais"
          >
            ↻ Nova
          </button>
          <button
            type="button"
            className="ai-btn"
            onClick={() => navigator.clipboard?.writeText(report?.text ?? '')}
            disabled={!report?.text}
            title="Copiar relatório"
          >
            ⧉
          </button>
          <button type="button" className="ai-btn ai-close" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>
      </header>

      <div className="ai-body" ref={bodyRef}>
        {status === 'error' && (
          <div className="ai-error">
            <strong>Não foi possível gerar a análise.</strong>
            <p>{error}</p>
            <button type="button" className="ai-btn" onClick={refresh}>Tentar de novo</button>
          </div>
        )}

        {busy && !report?.text && (
          <div className="ai-loading">
            <span className="ai-spinner" /> {STATUS_TEXT[status]}
          </div>
        )}

        {report?.text && (
          <div className="ai-report">
            <Report text={report.text} />
            {!report.done && <span className="ai-caret" />}
          </div>
        )}

        {!busy && !report && status !== 'error' && (
          <div className="ai-empty">
            <p>Gere um relatório técnico de {symbol} no timeframe {interval}.</p>
            <button type="button" className="ai-btn ai-btn-primary" onClick={refresh}>
              Analisar
            </button>
          </div>
        )}
      </div>

      {report?.done && (
        <footer className="ai-foot">
          Gerado {new Date(report.at).toLocaleTimeString('pt-BR')} · conteúdo informativo, não é
          recomendação de investimento.
        </footer>
      )}
    </aside>
  );
}
