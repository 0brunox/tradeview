# TradeView — Análise Gráfica (MVP estilo TradingView)

Gráfico de candles em tempo real com os principais indicadores técnicos, usando
**TradingView Lightweight Charts v5** no frontend e um backend **Node.js** que faz
proxy dos dados da **Binance** e (opcionalmente) os persiste em **PostgreSQL**.

## Funcionalidades

- 📊 Gráfico de **candles** (OHLC) com **zoom/pan** e crosshair
- ✏️ **Linhas de tendência**: desenhe clicando dois pontos, apague clicando na
  linha, persistidas por ativo/timeframe (plugin *series primitive* da v5)
- 🔎 **Busca de símbolo** (typeahead sobre todos os pares da Binance, com teclado)
- 💾 **Persistência do layout**: símbolo, timeframe e indicadores salvos no navegador
  (localStorage) e restaurados no reload — com botão de restaurar padrões
- ⏱️ **Timeframes**: 1m · 5m · 15m · 1h · 4h · 1d
- 📈 Indicadores calculados no browser (recalculam na hora):
  - **SMA** e **múltiplas EMAs** (adicione quantas quiser, cor e período por linha)
  - **Bandas de Bollinger**
  - **RSI** (com níveis 30/70)
  - **MACD** (linha, sinal e histograma, em painel próprio)
  - **KDJ** e **pivôs/swings** (calculados para a análise de IA)
  - **Volume** (overlay colorido)
- 📏 **Régua**: meça variação (%, absoluta), nº de barras e tempo entre dois pontos
- 🤖 **Análise por IA**: painel lateral com um relatório técnico do ativo/timeframe
  atual (panorama, leitura combinada dos indicadores, fluxo de derivativos, níveis
  e justificativa), escrito por **Claude** e transmitido em streaming
- ⭐ **Watchlist**: menu lateral com seus ativos favoritos e preço/variação 24h ao vivo
- ⚡ **Tempo real** via WebSocket (stream de klines da Binance)
- 🗄️ **PostgreSQL** como cache write-through — com *fallback automático* para
  modo proxy quando o banco não está disponível

## Estrutura

```
tradeview/
├─ docker-compose.yml        # Postgres opcional (cria o schema no 1º boot)
├─ server/                   # Backend Node.js (Express + ws + pg)
│  └─ src/
│     ├─ index.js            # bootstrap HTTP + WebSocket
│     ├─ config.js           # variáveis de ambiente
│     ├─ db/                 # pool + schema.sql
│     ├─ providers/binance.js# REST klines + exchangeInfo + normalização
│     ├─ services/           # candles.js (cache-aside) + symbols.js (busca)
│     ├─ routes/api.js       # GET /api/candles, /api/symbols, /api/health
│     ├─ routes/analyze.js   # POST /api/analyze (análise de IA, dev local)
│     └─ ws/hub.js           # fan-out de klines ao vivo por símbolo/timeframe
└─ web/                      # Frontend React + Vite
   ├─ api/                   # Serverless Functions da Vercel (produção)
   │  ├─ analyze.js          # POST /api/analyze
   │  └─ _analysis.js        # validação + prompt (compartilhado com o server/)
   └─ src/
      ├─ App.jsx             # estado, fetch, real-time, persistência
      ├─ components/         # Chart.jsx + Toolbar.jsx + SymbolSearch.jsx + AiPanel.jsx
      ├─ indicators/         # sma, ema, rsi, macd, bollinger, kdj, levels
      ├─ lib/                # storage.js, trendPrimitive.js, snapshot.js, markdown.js
      └─ api/                # cliente REST + WebSocket + ai.js
```

## Pré-requisitos

- **Node.js 18+** (testado no 24)
- **Docker** *(opcional)* — só se quiser o cache em PostgreSQL

## Como rodar

Abra **dois terminais**.

### 1) Backend

```bash
cd server
npm install
npm run dev
```

Sobe em `http://localhost:4000`. Sem `.env`, entra direto em **modo proxy**
(sem persistência) — já funciona assim.

### 2) Frontend

```bash
cd web
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Desenhando linhas de tendência

1. Clique em **✏ Linha** na barra (o cursor vira uma cruz).
2. Clique em **dois pontos** no gráfico — uma prévia acompanha o cursor entre o
   primeiro e o segundo clique.
3. Continue desenhando quantas quiser; clique em **✏ Linha** de novo (ou saia do
   modo) para parar.
4. **Fora** do modo desenho, passe o mouse sobre uma linha (ela se destaca) e
   **clique para apagá-la**. O botão **🗑** limpa todas do ativo/timeframe atual.

As linhas ficam salvas por **ativo + timeframe** no navegador (localStorage) e
reaparecem no reload.

## Análise por IA

O botão **🤖 Análise IA** abre um painel à direita com um relatório técnico do
ativo e timeframe atuais. O fluxo é:

1. O **browser** monta um *snapshot* numérico do mercado — médias móveis
   (5/10/20/60/120 + EMA 9/21), MACD, Bollinger, RSI (incluindo multi-timeframe),
   KDJ, pivôs e swings, volume, taxa de funding, Open Interest e os 40 candles
   mais recentes. Tudo calculado localmente, como os demais indicadores.
2. Esse snapshot vai por `POST /api/analyze`, onde é **validado campo a campo**:
   só números e símbolos/timeframes conhecidos passam. Nenhum texto livre do
   cliente entra no prompt.
3. O servidor chama o **Claude** (`claude-opus-5`) e devolve o relatório em
   **streaming**, então o texto aparece conforme é escrito.

Relatórios ficam em cache por ativo+timeframe enquanto o painel estiver aberto —
voltar para um par já analisado não gasta uma nova chamada. **↻ Nova** força
a regeração com os dados do momento.

### Configuração

A chave da Anthropic fica **sempre no servidor**, nunca no navegador.

**Local** — em `server/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

**Vercel** — em *Settings → Environment Variables* do projeto, adicione
`ANTHROPIC_API_KEY`. A function em `web/api/analyze.js` é publicada junto com o
site e responde na mesma origem.

Sem a chave, tudo o mais continua funcionando e o painel mostra o aviso de que a
análise não está configurada.

> ⚠️ O relatório é conteúdo informativo gerado por um modelo de linguagem a
> partir de indicadores técnicos — não é recomendação de investimento.

## PostgreSQL (opcional)

Com Docker instalado, na raiz do projeto:

```bash
docker compose up -d
```

Isso sobe o Postgres em `localhost:5432` e cria o schema automaticamente.
Depois, no backend:

```bash
cd server
cp .env.example .env   # o DATABASE_URL padrão já aponta pro container
npm run dev
```

No log deve aparecer `[db] connected — schema ready`, e `GET /api/health`
passa a responder `"db":"connected"`. Se o banco cair, o servidor volta
sozinho para o modo proxy.

## Deploy online (Vercel)

Em produção os dados de mercado vêm **direto da Binance**, sem backend
(`VITE_DATA_SOURCE=binance`, já definido em `web/.env.production`). Candles,
real-time, indicadores, desenho e persistência funcionam tudo no navegador.

A única peça de servidor é a Serverless Function `web/api/analyze.js`, que
guarda a chave da Anthropic e atende a análise de IA. Sem a variável de
ambiente, ela responde `503` e o resto do app segue normal.

**GitHub → Vercel (deploy contínuo):**

1. Suba o repositório (já inicializado com um commit):

   ```bash
   gh repo create tradeview --private --source . --remote origin --push
   ```

   Sem o `gh`: crie o repo no GitHub e rode
   `git remote add origin <url>` seguido de `git push -u origin main`.

2. Na Vercel: **Add New → Project** e importe o repositório.
3. Configure o projeto:
   - **Root Directory**: `web`
   - **Framework Preset**: Vite (detectado automaticamente)
   - **Build / Output**: padrão (`vite build` → `dist`)
   - **Environment Variables**: `ANTHROPIC_API_KEY` (só para a análise de IA;
     o `.env.production` já cuida do modo direto de dados)
4. **Deploy**. A partir daí, cada `git push` na branch principal publica sozinho.

> Só o `web/` é usado no deploy (incluindo `web/api/`). O `server/` + Postgres
> seguem no repo para uso local/self-hosted; a rota `/api/analyze` do backend
> local reaproveita o mesmo módulo `web/api/_analysis.js` da function, para os
> dois se comportarem igual.

## Variáveis de ambiente

**server/.env** (veja `server/.env.example`):

| Variável        | Padrão                                   | Descrição                                  |
|-----------------|------------------------------------------|--------------------------------------------|
| `PORT`          | `4000`                                   | Porta do backend                           |
| `WEB_ORIGIN`    | `http://localhost:5173`                  | Origem liberada no CORS                     |
| `BINANCE_REST`  | `https://api.binance.com`                | Endpoint REST (troque se houver geobloqueio)|
| `BINANCE_WS`    | `wss://stream.binance.com:9443`          | Endpoint WebSocket                          |
| `DATABASE_URL`  | *(vazio)*                                | Conexão Postgres; vazio = modo proxy        |
| `DB_ENABLED`    | `true`                                   | `false` desliga o banco de vez             |
| `ANTHROPIC_API_KEY` | *(vazio)*                            | Chave da análise de IA; vazio = rota dá 503 |

**web/.env** (veja `web/.env.example`): `VITE_API_BASE` e `VITE_WS_URL`.

> **Geobloqueio:** se `api.binance.com` estiver bloqueada na sua região, troque
> por `https://data-api.binance.vision` no `BINANCE_REST`.

## API do backend

- `GET /api/health` → `{ ok, db: "connected"|"proxy", time }`
- `GET /api/symbols` → símbolos populares · `?q=btc&limit=20` busca em toda a
  Binance (via `exchangeInfo`, cacheado 1h) → `[{ symbol, baseAsset, quoteAsset }]`
- `GET /api/candles?symbol=BTCUSDT&interval=1h&limit=800` → `{ symbol, interval, candles[] }`
- `POST /api/analyze` → corpo = snapshot de mercado; responde `text/plain` em
  streaming com o relatório em markdown (`503` se `ANTHROPIC_API_KEY` não estiver
  definida, `400` se o snapshot não passar na validação)
- `WS /ws` → envie `{ "type":"subscribe", "symbol":"BTCUSDT", "interval":"1m" }`;
  recebe `{ "type":"candle", "candle": { time, open, high, low, close, volume, closed } }`

## Notas de arquitetura

- **Indicadores no browser**: recalculam instantaneamente ao trocar timeframe ou
  ajustar períodos, sem round-trip ao servidor.
- **Um upstream por símbolo/timeframe**: o hub abre uma única conexão com a
  Binance por combinação e distribui para todos os clientes; reconecta sozinho.
- **Cache write-through**: cada fetch REST bem-sucedido é gravado no Postgres;
  candles fechados recebidos via WS também. Se a Binance falhar, o servidor lê do
  banco.
