# Spec: Coin Advisor — crypto buy/sell/hold decision-support

## Purpose
**Personal use only (v1):** this app is built for the owner's own use — a single local
user, run locally, **not deployed publicly** and not multi-tenant in this phase. No
sign-up, no sharing, no public exposure.

A personal, self-hosted web app that helps the user decide **when to buy, sell, or hold**
the cryptocurrencies they own (and ones they watch). For each coin it aggregates the
signals that matter — **technical indicators** computed from price history plus **news
sentiment** from crypto news feeds — and outputs a transparent **Buy / Hold / Sell**
recommendation with a confidence level and plain-English reasons, personalized by the
user's **cost basis** (P&L-aware take-profit / stop-loss suggestions).

It is **decision support, not price prediction and not financial advice** — every
recommendation shows the reasoning behind it and a clear disclaimer. Data comes from the
**CoinGecko free public API** (no key) and free **crypto news RSS feeds** (no key); no
scraping of exchange sites. Built as a **Java/Spring Boot** backend + **Postgres** +
lightweight web frontend, run locally via **docker-compose**, in a new repo at
`D:\internal_project\coin-advisor`.

## Requirements

### Data sources (no API keys, cached, rate-limit-aware)
- **Prices & history:** CoinGecko free API — current price/market data and daily price
  history per coin (for indicator math). Cache; on upstream failure serve last-known data.
- **News sentiment:** pull headlines from free crypto news **RSS feeds** (e.g. CoinDesk,
  Cointelegraph). Match headlines to a coin by name/symbol.

### Holdings & watchlist (personalization)
- Record holdings: coin, quantity, average buy price (cost basis). Persisted in Postgres.
- Maintain a watchlist of coins to analyze (with or without holdings).
- Show per-holding current value and unrealized P&L (absolute + %).

### Technical-indicator engine (deterministic, unit-tested)
- From daily price history compute: **RSI(14)**, **MACD** (12/26/9), **SMA(20)** &
  **SMA(50)** trend, short-term **momentum**, and **volatility**.
- Each indicator yields a bullish / neutral / bearish contribution.

### News-sentiment engine
- Score matched headlines with a small bullish/bearish keyword lexicon → a net sentiment
  (bullish / neutral / bearish) per coin, with the contributing headlines retained.

### Recommendation engine (the core output)
- Combine technical contributions + news sentiment into a weighted score →
  **Buy / Hold / Sell** with a **confidence** value.
- Produce **plain-English reasons** (e.g. "RSI 28 = oversold; price above 50-day MA; MACD
  bullish crossover 2 days ago; news sentiment mildly positive").
- For **held** coins, personalize using cost basis: current unrealized P&L, a suggested
  **take-profit** and **stop-loss** level, and P&L-aware notes (e.g. "up 42% and momentum
  fading → consider taking partial profit").
- Every recommendation carries a **"not financial advice"** disclaimer.

### Cross-cutting
- REST API returning JSON; a lightweight frontend that lists coins with their
  recommendation, confidence, reasons, and holdings P&L.
- Automated tests (JUnit): indicator math verified against known fixture values; the
  recommendation rules tested for representative buy/sell/hold cases; CoinGecko and RSS
  clients **mocked** so the suite runs deterministically **offline**.
- `docker-compose up` starts backend + Postgres (+ frontend). `README.md` documents setup,
  the data sources used, and the "not financial advice" disclaimer.

## Acceptance Criteria
- [ ] `docker-compose up` starts the app and Postgres; backend health endpoint returns 200.
- [ ] Can add a holding (coin, qty, avg buy price) and a watchlist coin; both persist across
      restart.
- [ ] For a coin with price history, the API returns a recommendation object containing:
      action (BUY/HOLD/SELL), confidence, and a non-empty list of reasons.
- [ ] Indicator math is correct: RSI, SMA, MACD each verified against known fixture inputs
      in unit tests (within tolerance).
- [ ] Recommendation rules are tested: a crafted oversold+bullish fixture yields BUY; an
      overbought+bearish fixture yields SELL; a mixed/neutral fixture yields HOLD.
- [ ] News sentiment: given fixture headlines, the sentiment score and matched headlines are
      computed and included in the recommendation reasons (verified by unit test).
- [ ] Held coins: recommendation includes unrealized P&L and suggested take-profit /
      stop-loss levels derived from cost basis (verified by unit test).
- [ ] CoinGecko and RSS clients are mocked in tests; the suite passes offline (no network).
- [ ] Upstream failure (CoinGecko or RSS unavailable) is handled gracefully — the coin still
      returns a recommendation from available data or a clear degraded state, not a 500
      (verified by a test simulating failure).
- [ ] Every recommendation response and the UI display a "not financial advice" disclaimer.
- [ ] `README.md` explains how to run, the data sources, the indicator/rule logic, and the
      disclaimer.

## Out of Scope (v1)
- Any claim of price *prediction* or guaranteed returns; automated/real trading or exchange
  order execution.
- **Public deployment / multi-user / sharing** — v1 is private, single-user, local-only.
- Real user accounts / auth / multi-user (single local user).
- Machine-learning / backtesting engine (v1 uses transparent rule-based signals).
- Real-time websockets/push; analysis runs on-demand and on an interval.
- Email/SMS/push alert delivery (recommendations shown in-app only).
- Web scraping/crawling of exchange or dashboard sites (rejected in favor of APIs/RSS).
- Non-USD valuation and mobile/native apps.
