// A symbol may carry an exchange prefix, e.g. "BYBIT:XRPUSDT".
// No prefix means Binance (keeps every existing stored symbol working).

export function parseSymbol(full) {
  const s = String(full ?? '');
  const i = s.indexOf(':');
  if (i === -1) return { source: 'binance', symbol: s };
  return { source: s.slice(0, i).toLowerCase(), symbol: s.slice(i + 1) };
}

export function fullSymbol(source, symbol) {
  return source === 'binance' ? symbol : `${source.toUpperCase()}:${symbol}`;
}

// Bare display symbol without the exchange prefix.
export function bareSymbol(full) {
  return parseSymbol(full).symbol;
}

// Group full symbols by source → { binance: [...bare], bybit: [...bare] }.
export function groupBySource(fullSymbols) {
  const groups = {};
  for (const f of fullSymbols) {
    const { source, symbol } = parseSymbol(f);
    (groups[source] ||= []).push(symbol);
  }
  return groups;
}
