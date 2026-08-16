// Painel flutuante com a leitura ICT do ativo/timeframe atual.
//
// Consome o MESMO objeto que o gráfico desenha (`buildIctContext`), então o que
// está escrito aqui e o que está marcado nos candles nunca divergem.
// O arraste fica em FloatingPanel; aqui só passam `xy` e `onMove`.
import FloatingPanel from './FloatingPanel.jsx';

const BIAS_LABEL = {
  bull: { text: 'Alta', cls: 'ict-bull' },
  bear: { text: 'Baixa', cls: 'ict-bear' },
  neutral: { text: 'Indefinido', cls: 'ict-flat' },
};

const ZONE_LABEL = {
  premium: { text: 'Premium', cls: 'ict-bear', hint: 'Preço caro no range — o ICT procura VENDAS aqui.' },
  discount: { text: 'Discount', cls: 'ict-bull', hint: 'Preço barato no range — o ICT procura COMPRAS aqui.' },
  equilibrium: { text: 'Equilíbrio', cls: 'ict-flat', hint: 'Preço em torno dos 50% do range.' },
};

const PO3_LABEL = {
  accumulation: 'Acumulação',
  manipulation: 'Manipulação',
  distribution: 'Distribuição',
};

// Mesma lógica de casas decimais do gráfico, para micro-caps não virarem 0.00.
function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const prec = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : a >= 0.0001 ? 6 : 8;
  return v.toLocaleString('en-US', { maximumFractionDigits: prec });
}

function Row({ label, children, title }) {
  return (
    <tr title={title}>
      <td className="ict-key">{label}</td>
      <td className="ict-val">{children}</td>
    </tr>
  );
}

export default function IctPanel({ ict, position = 'top-left', xy = null, onMove, onClose }) {
  const shell = {
    className: 'ict-panel',
    position,
    xy,
    onMove,
    headClassName: 'ict-head',
  };

  if (!ict) {
    return (
      <FloatingPanel
        {...shell}
        head={(
          <>
            <span>ICT</span>
            {onClose && <button type="button" className="ict-close" onClick={onClose}>×</button>}
          </>
        )}
      >
        <div className="ict-empty">Histórico insuficiente.</div>
      </FloatingPanel>
    );
  }

  const bias = BIAS_LABEL[ict.structure.bias] ?? BIAS_LABEL.neutral;
  const last = ict.structure.last;
  const zone = ict.range ? ZONE_LABEL[ict.range.zone] : null;
  const { above, below } = ict.targets;
  const swept = ict.pools.filter((p) => p.swept).length;

  return (
    <FloatingPanel
      {...shell}
      head={(
        <>
          <span>ICT · viés</span>
          {onClose && <button type="button" className="ict-close" onClick={onClose} title="Fechar painel">×</button>}
        </>
      )}
    >
      <table className="ict-table">
        <tbody>
          <Row label="Estrutura" title="Direção definida pelo último rompimento de estrutura.">
            <span className={bias.cls}>{bias.text}</span>
            {last && (
              <span className="ict-sub">
                {' '}
                {last.type}
                {last.displacement ? ' ⚡' : ''} @ {fmtPrice(last.price)}
              </span>
            )}
          </Row>

          {ict.range && (
            <>
              <Row label="Zona" title={zone.hint}>
                <span className={zone.cls}>{zone.text}</span>
                <span className="ict-sub"> {(ict.range.pricePct * 100).toFixed(0)}% do range</span>
              </Row>
              <Row label="Equilíbrio" title="50% do dealing range atual.">
                {fmtPrice(ict.range.equilibrium)}
              </Row>
              <Row
                label="OTE"
                title={`Optimal Trade Entry — retração 0.62–0.79 da perna de ${
                  ict.range.dir === 'bull' ? 'alta (zona de compra)' : 'baixa (zona de venda)'}.`}
              >
                <span className={ict.range.inOte ? 'ict-hot' : ''}>
                  {fmtPrice(ict.range.ote.bottom)}–{fmtPrice(ict.range.ote.top)}
                </span>
                {ict.range.inOte && <span className="ict-flag">dentro</span>}
              </Row>
            </>
          )}

          <Row label="Liquidez ↑" title="Buyside liquidity: alvo acima do preço.">
            {above ? (
              <>
                {fmtPrice(above.price)}
                <span className="ict-sub"> +{above.distancePct.toFixed(2)}%</span>
                {above.touches > 1 && <span className="ict-flag">EQH ×{above.touches}</span>}
              </>
            ) : '—'}
          </Row>

          <Row label="Liquidez ↓" title="Sellside liquidity: alvo abaixo do preço.">
            {below ? (
              <>
                {fmtPrice(below.price)}
                <span className="ict-sub"> {below.distancePct.toFixed(2)}%</span>
                {below.touches > 1 && <span className="ict-flag">EQL ×{below.touches}</span>}
              </>
            ) : '—'}
          </Row>

          <Row label="FVG abertos" title="Fair Value Gaps ainda não preenchidos.">
            {ict.fvgs.length || '—'}
            {ict.nearestFvg && (
              <span className="ict-sub">
                {' '}mais perto {fmtPrice(ict.nearestFvg.ce)} <em>CE</em>
              </span>
            )}
          </Row>

          <Row label="Order blocks" title="Blocos que ainda não foram perdidos.">
            {ict.blocks.length || '—'}
            {ict.nearestBlock && (
              <span className="ict-sub">
                {' '}mais perto {fmtPrice(ict.nearestBlock.bottom)}–{fmtPrice(ict.nearestBlock.top)}
              </span>
            )}
          </Row>

          {swept > 0 && (
            <Row label="Sweeps" title="Pools de liquidez já varridos (stop hunt) no histórico visível.">
              {swept}
            </Row>
          )}

          {ict.activeKillzone && (
            <Row label="Killzone" title="Janela de horário de Nova York em que o ICT espera os movimentos.">
              <span className="ict-hot">{ict.activeKillzone.label}</span>
            </Row>
          )}

          {ict.po3 && (
            <Row label="Power of 3" title="Acumulação (range asiático) → Manipulação (Judas) → Distribuição.">
              {PO3_LABEL[ict.po3.phase]}
              {ict.po3.judas && (
                <span className="ict-sub">
                  {' '}Judas {ict.po3.judas.dir === 'up' ? '↑' : '↓'} → viés{' '}
                  <span className={ict.po3.bias === 'bull' ? 'ict-bull' : 'ict-bear'}>
                    {ict.po3.bias === 'bull' ? 'alta' : 'baixa'}
                  </span>
                </span>
              )}
            </Row>
          )}
        </tbody>
      </table>
    </FloatingPanel>
  );
}
