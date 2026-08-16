// Vigia os preços e avisa quando um alerta armado é atingido.
//
// Duas fontes se complementam:
// - o ativo aberto no gráfico chega pelo WebSocket, tick a tick;
// - os demais ativos com alerta armado entram numa consulta periódica de ticker
//   (a mesma rota usada pela watchlist), então um alerta continua valendo
//   depois de trocar de par.
//
// Quem marca/persiste o disparo é o App — aqui só reportamos via `onTrigger`.
// Devolve os preços da última consulta, que o painel usa para mostrar quanto
// falta até cada alvo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTickers } from '../api/rest.js';
import { alertFires } from './alerts.js';

const POLL_MS = 15000;

export function useAlertWatcher({ alerts, liveCandle, onTrigger }) {
  const [prices, setPrices] = useState({}); // símbolo → último preço consultado
  // Ids já disparados nesta sessão: entre o disparo e o estado atualizar cabem
  // vários ticks, e sem isso o mesmo alerta avisaria em duplicidade.
  const firedRef = useRef(new Set());
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  // Alerta rearmado volta a ser elegível; alerta apagado sai do conjunto.
  useEffect(() => {
    const byId = new Map(alerts.map((a) => [a.id, a]));
    for (const id of firedRef.current) {
      const a = byId.get(id);
      if (!a || (a.status === 'armed' && !a.triggeredAt)) firedRef.current.delete(id);
    }
  }, [alerts]);

  const check = useCallback((symbol, price) => {
    for (const a of alertsRef.current) {
      if (a.symbol !== symbol || firedRef.current.has(a.id)) continue;
      if (alertFires(a, price)) {
        firedRef.current.add(a.id);
        onTriggerRef.current?.(a, price);
      }
    }
  }, []);

  // Tick do gráfico: o candle em formação traz o preço atual do par aberto.
  useEffect(() => {
    if (!liveCandle?.candle) return;
    check(liveCandle.symbol, liveCandle.candle.close);
  }, [liveCandle, check]);

  // Chave textual dos símbolos armados: só reinicia o polling quando o conjunto
  // muda de verdade, não a cada edição de um alerta.
  const armedKey = useMemo(
    () => [...new Set(alerts.filter((a) => a.status === 'armed').map((a) => a.symbol))].sort().join(','),
    [alerts],
  );

  useEffect(() => {
    if (!armedKey) return undefined;
    const symbols = armedKey.split(',');
    let alive = true;
    const poll = () => {
      fetchTickers(symbols)
        .then((rows) => {
          if (!alive || !rows.length) return;
          setPrices((prev) => {
            const next = { ...prev };
            for (const r of rows) next[r.symbol] = r.price;
            return next;
          });
          for (const r of rows) check(r.symbol, r.price);
        })
        .catch(() => { /* rede instável — a próxima rodada tenta de novo */ });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [armedKey, check]);

  return prices;
}
