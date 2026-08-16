// Casca de painel flutuante arrastável, compartilhada pelo RSI MTF e pelo ICT.
//
// Enquanto o usuário não arrasta, o painel fica ancorado num canto do palco via
// CSS (`fp-top-left` etc.). No primeiro arraste ele passa a viver em coordenadas
// livres (`xy`), que o App persiste junto com os indicadores.
import { useEffect, useRef, useState } from 'react';

const EDGE = 4; // folga mínima entre o painel e a borda do gráfico
const DRAG_SLOP = 3; // movimento abaixo disso ainda conta como clique

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Prende uma posição livre dentro do palco (.stage), para o painel nunca sumir
// fora da área visível do gráfico.
function clampToStage(el, x, y) {
  const stage = el.offsetParent;
  const w = stage ? stage.clientWidth : window.innerWidth;
  const h = stage ? stage.clientHeight : window.innerHeight;
  return {
    x: clamp(x, EDGE, Math.max(EDGE, w - el.offsetWidth - EDGE)),
    y: clamp(y, EDGE, Math.max(EDGE, h - el.offsetHeight - EDGE)),
  };
}

/**
 * @param {string}   className     classe visual do painel (`rsi-panel`, `ict-panel`)
 * @param {string}   position      canto de ancoragem enquanto `xy` for nulo
 * @param {?object}  xy            posição livre `{ x, y }` em pixels do palco
 * @param {Function} onMove        recebe a nova posição, ou `null` ao reancorar
 * @param {string}   headClassName classe do cabeçalho (também é a alça de arraste)
 * @param {node}     head          conteúdo do cabeçalho
 */
export default function FloatingPanel({
  className = '',
  position = 'top-left',
  xy = null,
  onMove,
  headClassName = '',
  head,
  children,
}) {
  const ref = useRef(null);
  const dragRef = useRef(null); // estado vivo do arraste; não dispara render
  const [drag, setDrag] = useState(null); // posição enquanto o ponteiro está preso

  // O commit acontece só no pointerup, então o callback é lido por ref para os
  // handlers não dependerem de closures recriadas a cada render.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const pos = drag ?? xy;

  // Posição salva pode estar fora dos limites atuais (janela menor que na última
  // sessão, watchlist reaberta, etc.) — reancora na montagem e a cada resize.
  useEffect(() => {
    if (!xy) return undefined;
    const fix = () => {
      const el = ref.current;
      if (!el) return;
      const c = clampToStage(el, xy.x, xy.y);
      if (Math.abs(c.x - xy.x) > 0.5 || Math.abs(c.y - xy.y) > 0.5) onMoveRef.current?.(c);
    };
    fix();
    window.addEventListener('resize', fix);
    return () => window.removeEventListener('resize', fix);
  }, [xy]);

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, a')) return; // controles do cabeçalho
    const el = ref.current;
    if (!el) return;
    // offsetLeft/Top já são relativos ao palco, inclusive quando o painel ainda
    // está ancorado por CSS num canto — o arraste começa sem salto.
    dragRef.current = { px: e.clientX, py: e.clientY, x: el.offsetLeft, y: el.offsetTop, moved: false };
    setDrag({ x: el.offsetLeft, y: el.offsetTop });
    // Capturar mantém o arraste funcionando quando o ponteiro sai do cabeçalho
    // (ou sai da janela); sem captura o arraste ainda anda, só perde o pointerup.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    e.preventDefault();
  };

  const handlePointerMove = (e) => {
    const d = dragRef.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    d.moved = true;
    d.last = clampToStage(el, d.x + dx, d.y + dy);
    setDrag(d.last);
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // Os dois updates entram no mesmo lote do React 18: a posição local sai e a
    // persistida entra no mesmo render, sem piscar.
    setDrag(null);
    if (d.moved && d.last) onMoveRef.current?.(d.last);
  };

  const cls = ['floating-panel', className, pos ? '' : `fp-${position}`, drag ? 'fp-dragging' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      style={pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div
        className={`fp-handle ${headClassName}`}
        title="Arraste para mover · duplo clique volta ao canto"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => onMoveRef.current?.(null)}
      >
        {head}
      </div>
      {children}
    </div>
  );
}
