import { useEffect, useMemo, useState } from 'react';
import { fetchAggOpenInterest, fetchCurrentOi, fetchFundingSources } from '../api/derivatives.js';
import { fetchSpotDelta } from '../api/spotFlow.js';
import { cvdCandles, oiCandles, fundingSeries } from '../indicators/flow.js';
import { bareSymbol } from '../api/source.js';

// Os três painéis vêm de REST, não do stream de klines: o candle em formação só
// ganha fluxo no refresh. 30s acompanha bem até o gráfico de 1m sem pesar nos
// limites das corretoras (são ~6 requisições por ciclo, com tudo ligado).
const REFRESH_MS = 30000;

const EMPTY = { delta: [], oi: [], funding: {}, weights: null, info: {} };

/**
 * Carrega o fluxo agregado do ativo aberto (delta spot, Open Interest e
 * funding) e o encaixa no eixo de tempo dos candles do gráfico.
 *
 * Só busca o que está ligado; quando o funding está ligado sem o painel de OI,
 * puxa só o OI atual de cada corretora, que é o peso da média — não o histórico.
 * → { cvd, oi, funding, info }
 */
export function useFlowData({ symbol, interval, candles, cvd, oi, funding }) {
  const [raw, setRaw] = useState(EMPTY);
  const anyOn = cvd || oi || funding;

  useEffect(() => {
    if (!anyOn) {
      setRaw(EMPTY);
      return undefined;
    }
    let cancelled = false;
    const perp = bareSymbol(symbol); // o prefixo da corretora não vale no derivativo

    const load = async () => {
      const [delta, oiAgg, fundingSrc, currentOi] = await Promise.all([
        cvd ? fetchSpotDelta(perp, interval).catch(() => null) : null,
        oi ? fetchAggOpenInterest(perp, interval).catch(() => null) : null,
        funding ? fetchFundingSources(perp, interval).catch(() => null) : null,
        funding && !oi ? fetchCurrentOi(perp).catch(() => null) : null,
      ]);
      if (cancelled) return;

      const lastOi = oiAgg?.rows?.length ? oiAgg.rows[oiAgg.rows.length - 1].parts : null;
      setRaw({
        delta: delta?.rows ?? [],
        oi: oiAgg?.rows ?? [],
        funding: fundingSrc?.series ?? {},
        weights: lastOi ?? currentOi ?? null,
        info: {
          markets: delta?.markets ?? [],
          oiSources: oiAgg?.sources ?? [],
          oiPeriod: oiAgg?.period ?? null,
          fundingSources: fundingSrc?.sources ?? [],
        },
      });
    };

    setRaw(EMPTY); // limpa o fluxo do ativo anterior enquanto o novo carrega
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol, interval, cvd, oi, funding, anyOn]);

  const candleTimes = useMemo(() => (candles ?? []).map((c) => c.time), [candles]);

  return useMemo(() => ({
    cvd: cvd ? cvdCandles(raw.delta, candleTimes) : [],
    oi: oi ? oiCandles(raw.oi, candleTimes) : [],
    funding: funding ? fundingSeries(raw.funding, raw.weights, candleTimes) : [],
    info: raw.info,
  }), [raw, candleTimes, cvd, oi, funding]);
}
