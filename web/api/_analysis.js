// Núcleo da análise de IA, compartilhado entre a function da Vercel
// (web/api/analyze.js) e a rota do backend local (server/src/routes/analyze.js).
//
// Sem dependências de propósito: cada host importa o SDK da Anthropic a partir
// do seu próprio node_modules. Arquivos com prefixo `_` não viram rotas na Vercel.

export const MODEL = 'claude-opus-5';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '12h', '1d', '1w', '1M'];
const MAX_CANDLES = 60;

// --- sanitização -----------------------------------------------------------
// O payload vem do browser, então nada dele entra no prompt sem passar por
// aqui. Números viram números; strings passam por regex. Isso impede que o
// endpoint seja usado como proxy de texto livre para o modelo.

// Só número finito ou string numérica passam. `null`, `undefined`, `true`, `''`
// e `[]` viram null em vez de 0 (Number(null) === 0), porque o prompt trata
// null como "dado indisponível" — um 0 falso seria lido como valor real.
function n(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

/** Objeto simples cujas chaves são fixas e cujos valores são números ou null. */
function nums(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  for (const key of keys) out[key] = n(obj[key]);
  return out;
}

/** Array de números, limitado a `max` itens. */
function numArray(arr, max = 10) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, max).map(n).filter((v) => v !== null);
}

// Campos textuais do bloco ICT. Nenhuma string do cliente é repassada: ou o
// valor é um dos rótulos previstos, ou vira null. É o que mantém a garantia de
// que o endpoint não serve como proxy de texto livre para o modelo.
const enumOf = (allowed) => (v) => (allowed.includes(v) ? v : null);
const bool = (v) => v === true;

const asBias = enumOf(['bull', 'bear', 'neutral']);
const asDir = enumOf(['bull', 'bear']);
const asZone = enumOf(['premium', 'discount', 'equilibrium']);
const asEventType = enumOf(['BOS', 'CHoCH']);
const asFvgState = enumOf(['open', 'partial', 'filled']);
const asObState = enumOf(['fresh', 'mitigated', 'broken']);
const asObKind = enumOf(['ob', 'breaker']);
const asPoolKind = enumOf(['BSL', 'SSL']);
const asKillzone = enumOf(['asia', 'london', 'nyopen', 'nyclose']);
const asPo3Phase = enumOf(['accumulation', 'manipulation', 'distribution']);
const asJudasDir = enumOf(['up', 'down']);

/** Bloco ICT: números por `n()`, textos por lista fechada, arrays limitados. */
function sanitizeIct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const list = (arr, max, fn) => (Array.isArray(arr) ? arr.slice(0, max).map(fn) : []);

  return {
    bias: asBias(raw.bias),
    lastEvent: raw.lastEvent && typeof raw.lastEvent === 'object' ? {
      type: asEventType(raw.lastEvent.type),
      dir: asDir(raw.lastEvent.dir),
      price: n(raw.lastEvent.price),
      displacement: bool(raw.lastEvent.displacement),
    } : null,
    range: raw.range && typeof raw.range === 'object' ? {
      ...nums(raw.range, ['high', 'low', 'equilibrium', 'pricePct', 'oteTop', 'oteBottom']),
      zone: asZone(raw.range.zone),
      legDir: asDir(raw.range.legDir),
      inOte: bool(raw.range.inOte),
    } : null,
    fvgs: list(raw.fvgs, 8, (g) => ({
      dir: asDir(g?.dir),
      ...nums(g, ['top', 'bottom', 'ce']),
      state: asFvgState(g?.state),
    })),
    orderBlocks: list(raw.orderBlocks, 8, (b) => ({
      dir: asDir(b?.dir),
      kind: asObKind(b?.kind),
      ...nums(b, ['top', 'bottom']),
      state: asObState(b?.state),
    })),
    liquidity: list(raw.liquidity, 8, (p) => ({
      kind: asPoolKind(p?.kind),
      ...nums(p, ['price', 'touches', 'distancePct']),
      swept: bool(p?.swept),
    })),
    targetAbove: n(raw.targetAbove),
    targetBelow: n(raw.targetBelow),
    killzone: asKillzone(raw.killzone),
    po3: raw.po3 && typeof raw.po3 === 'object' ? {
      phase: asPo3Phase(raw.po3.phase),
      judasDir: asJudasDir(raw.po3.judasDir),
      bias: asDir(raw.po3.bias),
    } : null,
  };
}

export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('snapshot ausente');

  // Prefixo de exchange opcional (ex.: "BYBIT:XRPUSDT"), depois o par.
  const symbol = String(raw.symbol ?? '').toUpperCase();
  if (!/^(?:[A-Z]{2,12}:)?[A-Z0-9]{4,20}$/.test(symbol)) throw new Error('símbolo inválido');

  const interval = String(raw.interval ?? '');
  if (!INTERVALS.includes(interval)) throw new Error('timeframe inválido');

  const exchange = /^[a-z]{2,16}$/.test(String(raw.exchange ?? '')) ? raw.exchange : 'binance';

  // RSI multi-timeframe: só chaves de timeframe conhecidas, só valores numéricos.
  const mtfRaw = raw.rsi?.multiTimeframe;
  const multiTimeframe = {};
  if (mtfRaw && typeof mtfRaw === 'object') {
    for (const tf of INTERVALS) {
      if (tf in mtfRaw) multiTimeframe[tf] = n(mtfRaw[tf]);
    }
  }

  const candles = Array.isArray(raw.candles)
    ? raw.candles.slice(-MAX_CANDLES).map((c) => ({
        t: n(c?.t),
        o: n(c?.o),
        h: n(c?.h),
        l: n(c?.l),
        c: n(c?.c),
        v: n(c?.v),
      }))
    : [];

  return {
    symbol,
    exchange,
    interval,
    price: nums(raw.price, [
      'last', 'changePct24h', 'high24h', 'low24h', 'volume24h', 'quoteVolume24h', 'barChangePct',
    ]),
    ma: nums(raw.ma, ['ma5', 'ma10', 'ma20', 'ma60', 'ma120', 'ema9', 'ema21']),
    macd: nums(raw.macd, ['dif', 'dea', 'hist', 'histPrev']),
    boll: nums(raw.boll, ['upper', 'middle', 'lower', 'percentB', 'bandwidthPct']),
    rsi: {
      period: n(raw.rsi?.period) ?? 14,
      current: n(raw.rsi?.current),
      recent: numArray(raw.rsi?.recent, 10),
      multiTimeframe,
    },
    kdj: nums(raw.kdj, ['k', 'd', 'j', 'kPrev', 'dPrev']),
    levels: {
      pivot: nums(raw.levels?.pivot, ['pivot', 'r1', 'r2', 'r3', 's1', 's2', 's3']),
      swingHighs: numArray(raw.levels?.swingHighs, 6),
      swingLows: numArray(raw.levels?.swingLows, 6),
      range20: nums(raw.levels?.range20, ['high', 'low', 'bars']),
      range60: nums(raw.levels?.range60, ['high', 'low', 'bars']),
      range200: nums(raw.levels?.range200, ['high', 'low', 'bars']),
    },
    volume: nums(raw.volume, ['lastBar', 'avg20', 'ratioToAvg20']),
    derivatives: nums(raw.derivatives, [
      'fundingRatePct', 'markPrice', 'openInterestUsd', 'openInterestChangePct24h',
    ]),
    ict: sanitizeIct(raw.ict),
    candles,
  };
}

// --- prompts ---------------------------------------------------------------

export const SYSTEM_PROMPT = `Você é um analista técnico de mercados de criptomoedas. Recebe um retrato numérico de um ativo (indicadores já calculados, níveis de preço, dados de derivativos e candles recentes) e produz um relatório de análise em **português do Brasil**.

# Regras de conteúdo
- Baseie TODA afirmação nos números fornecidos. Nunca invente valores, notícias, eventos ou dados que não estejam no payload.
- Campos com valor \`null\` significam dado indisponível. Diga explicitamente que o dado não está disponível em vez de estimá-lo.
- Cite os números concretos que sustentam cada leitura (ex.: "MACD com histograma em -0.00041").
- Quando os sinais forem contraditórios, diga isso — não force uma narrativa coerente que os dados não sustentam.
- Preços devem ser escritos com a mesma precisão decimal que aparece no payload.

# Formato de saída (markdown, exatamente esta estrutura)
# {SÍMBOLO} {TIMEFRAME} — Relatório de Análise

## Panorama
Lista com: Preço Atual, Variação 24h, Suporte Principal (S1 e S2), Resistência Principal (R1 e R2), Tendência Atual.

## Explicação Detalhada
### Análise Técnica Combinada
Um item por indicador presente: Médias Móveis, MACD, Bandas de Bollinger, RSI (incluindo a leitura multi-timeframe), KDJ.
### Leitura ICT / Smart Money
Só inclua esta seção se \`ict\` não for null. Cubra, nesta ordem e só o que existir:
estrutura (último BOS/CHoCH e se houve displacement), posição no dealing range
(premium / discount / equilíbrio e a zona OTE), liquidez (para onde é o *draw on
liquidity* — o pool mais provável de ser buscado — e o que já foi varrido), e os
FVGs / order blocks ainda abertos que estejam mais perto do preço. Se houver
\`po3\`, diga em que fase o pregão está e o que o Judas Swing sugere.
### Análise de Dados e Fluxo
Taxa de funding, Open Interest e comportamento do volume.

## Resultado da Análise
- **Direção**: viés operacional
- **Momento de Entrada**: zona de preço e a condição que a valida
- **Stop Loss**: nível e o motivo técnico dele
- **Preço Alvo**: alvos com o ganho percentual a partir do preço atual

Quando \`ict\` existir, ancore entrada, stop e alvo nos níveis dele — entrada em
FVG / order block / OTE, stop além do extremo que os invalida, alvo no pool de
liquidez oposto — em vez de inventar níveis redondos. Se a leitura ICT
contradisser os indicadores clássicos, diga isso abertamente em vez de escolher
um lado em silêncio.

## Justificativa Final
Um parágrafo amarrando a leitura e nomeando o principal risco da tese.

Encerre com esta linha, literalmente:
> ⚠️ Esta análise é apenas informativa e não constitui recomendação de investimento. Negociar criptomoedas e derivativos envolve alto risco de perda.

# Estilo
Seja direto e denso. Cada item traz a leitura e o número que a sustenta, sem repetir o que já foi dito em outra seção. O relatório inteiro deve caber em torno de 600–900 palavras — não o infle com repetição, ressalvas genéricas ou seções de alternativas que você descartou.`;

/** Prompt do usuário: cabeçalho legível + payload JSON validado. */
export function buildUserPrompt(snap) {
  return [
    `Analise ${snap.symbol} no timeframe ${snap.interval} (fonte: ${snap.exchange}).`,
    '',
    'Dados de mercado:',
    '```json',
    JSON.stringify(snap, null, 1),
    '```',
    '',
    'Notas sobre o payload:',
    '- `ma`: médias móveis simples (ma*) e exponenciais (ema*) dos fechamentos.',
    '- `macd`: dif = linha MACD, dea = linha de sinal, hist = histograma (12/26/9).',
    '- `boll`: Bollinger 20/2. `percentB` = 0 na banda inferior, 1 na superior.',
    '- `rsi.multiTimeframe`: RSI final de cada timeframe, mesmo período.',
    '- `levels.pivot`: pivôs clássicos sobre o último candle FECHADO deste timeframe.',
    '- `levels.swingHighs`/`swingLows`: topos e fundos recentes, do mais novo ao mais antigo.',
    '- `volume.ratioToAvg20`: volume do último candle dividido pela média de 20.',
    '- `derivatives.fundingRatePct`: taxa de funding do perp em % por período de 8h.',
    '- `candles`: os mais recentes, em ordem cronológica (t = epoch em segundos).',
    '- `ict`: leitura Smart Money (null quando não há histórico suficiente).',
    '  - `bias`/`lastEvent`: direção da estrutura e o último rompimento. `BOS` = a favor',
    '    da direção vigente (continuação); `CHoCH` = contra ela (possível reversão).',
    '    `displacement: true` = o candle do rompimento teve range bem acima da média.',
    '  - `range`: dealing range. `pricePct` 0 = fundo, 1 = topo; `equilibrium` = 50%.',
    '    `legDir` é a direção da perna de impulso, e a faixa `oteBottom`–`oteTop` é a',
    '    OTE (retração 0.62–0.79): zona de COMPRA se legDir=bull, de VENDA se bear.',
    '  - `fvgs`: Fair Value Gaps ainda abertos. `ce` = 50% do gap, o nível de reação.',
    '  - `orderBlocks`: `kind: "breaker"` é um bloco que falhou e inverteu de polaridade.',
    '  - `liquidity`: pools de stops. `touches > 1` = topos/fundos iguais (EQH/EQL),',
    '    que concentram mais ordens. `swept: true` = a liquidez ali JÁ foi tomada.',
    '  - `targetAbove`/`targetBelow`: os pools ainda intactos mais próximos de cada lado.',
    '  - `killzone`: janela de NY ativa agora; `po3.phase`: fase do Power of 3, e',
    '    `po3.bias` é o viés esperado DEPOIS do Judas Swing (contrário ao lado varrido).',
    '',
    'IMPORTANTE: o último candle ainda está em formação, então seu volume é',
    'parcial por construção. Não trate um `volume.ratioToAvg20` baixo como queda',
    'de volume — compare o volume dos candles JÁ FECHADOS em `candles`.',
  ].join('\n');
}

/** Parâmetros da chamada à Messages API, idênticos nos dois hosts. */
export function requestParams(snap) {
  return {
    model: MODEL,
    max_tokens: 16000,
    // Opus 5 pensa por padrão; effort médio equilibra qualidade e latência aqui.
    output_config: { effort: 'medium' },
    // Se os classificadores recusarem, a própria API reexecuta num modelo de
    // fallback em vez de devolver a recusa.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(snap) }],
  };
}

/**
 * Traduz o erro do SDK numa mensagem que faz sentido no painel — sem isso o
 * usuário recebia o JSON cru da API. Feito por `status`/mensagem em vez das
 * classes do SDK, para este módulo continuar sem dependências.
 */
export function friendlyError(err) {
  const status = err?.status;
  const apiMessage = err?.error?.error?.message ?? err?.message ?? 'erro desconhecido';

  if (/credit balance is too low/i.test(apiMessage)) {
    return 'A conta da Anthropic está sem créditos. Adicione créditos em Plans & Billing no console.anthropic.com.';
  }
  if (status === 401) return 'Chave da Anthropic inválida ou revogada.';
  if (status === 403) return 'Esta chave não tem acesso ao modelo usado na análise.';
  if (status === 429) return 'Limite de requisições atingido. Tente de novo em alguns instantes.';
  if (status >= 500) return 'A API da Anthropic está indisponível agora. Tente de novo em instantes.';
  if (err?.name === 'APIConnectionError') return 'Não foi possível alcançar a API da Anthropic. Verifique a conexão.';
  return apiMessage;
}

/**
 * Roda a análise em streaming, entregando o texto em pedaços via `write`.
 * `client` é um cliente `@anthropic-ai/sdk` já construído pelo host.
 * → mensagem final (para inspecionar `stop_reason`).
 */
export async function streamAnalysis(client, snap, write) {
  const stream = client.beta.messages.stream(requestParams(snap));

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      write(event.delta.text);
    }
  }

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    write('\n\n> ⚠️ O modelo não pôde concluir esta análise. Tente novamente.');
  } else if (message.stop_reason === 'max_tokens') {
    write('\n\n> ⚠️ Relatório truncado por limite de tokens.');
  }

  return message;
}
