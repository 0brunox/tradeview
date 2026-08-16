// Modelo dos alertas de preço.
//
// Cada alerta guarda o preço-alvo e a direção do cruzamento. A direção é
// derivada do preço de mercado no momento da criação: alvo acima do mercado
// dispara na subida, alvo abaixo dispara na queda. Com isso o disparo vira uma
// comparação simples contra o preço atual — sem depender de um histórico de
// ticks, que se perderia no reload da página.

const newId = () =>
  (crypto.randomUUID ? crypto.randomUUID() : `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/** Direção do cruzamento de um alvo em relação ao preço de mercado. */
export function alertDir(price, refPrice) {
  return refPrice != null && Number.isFinite(refPrice) && price < refPrice ? 'below' : 'above';
}

export function makeAlert({ symbol, price, refPrice = null, note = '' }) {
  return {
    id: newId(),
    symbol, // símbolo completo, com prefixo de fonte quando houver (BYBIT:…)
    price,
    dir: alertDir(price, refPrice),
    note: String(note ?? '').trim(),
    refPrice,
    createdAt: Date.now(),
    status: 'armed', // 'armed' | 'triggered'
    triggeredAt: null,
    triggeredPrice: null,
  };
}

/** Este preço dispara o alerta? */
export function alertFires(alert, price) {
  if (!alert || alert.status !== 'armed') return false;
  if (price == null || !Number.isFinite(price)) return false;
  return alert.dir === 'above' ? price >= alert.price : price <= alert.price;
}

export function triggerAlert(alert, price) {
  return { ...alert, status: 'triggered', triggeredAt: Date.now(), triggeredPrice: price };
}

/** Rearma um alerta disparado, recalculando a direção pelo preço atual. */
export function rearmAlert(alert, refPrice = null) {
  return {
    ...alert,
    status: 'armed',
    triggeredAt: null,
    triggeredPrice: null,
    dir: refPrice != null ? alertDir(alert.price, refPrice) : alert.dir,
    refPrice: refPrice ?? alert.refPrice,
  };
}

/** Armados primeiro (mais perto do disparo na frente), depois os já disparados. */
export function sortAlerts(alerts, priceBySymbol = {}) {
  const dist = (a) => {
    const p = priceBySymbol[a.symbol];
    return p ? Math.abs(a.price - p) / p : Number.POSITIVE_INFINITY;
  };
  return [...alerts].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'armed' ? -1 : 1;
    if (a.status === 'triggered') return (b.triggeredAt ?? 0) - (a.triggeredAt ?? 0);
    return dist(a) - dist(b) || a.symbol.localeCompare(b.symbol) || b.price - a.price;
  });
}

// Mesma régua de casas decimais do gráfico — micro-caps não podem virar 0,00.
export function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const prec = a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : a >= 0.0001 ? 6 : 8;
  return v.toLocaleString('en-US', { maximumFractionDigits: prec });
}

/** hh:mm de um timestamp, para a lista e os avisos. */
export function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
