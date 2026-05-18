# Daily Space Stock Signals

This project is a static Daily Space PWA plus a Node 22 backend for a US stock watchlist, public-company filings, event reminders, and explainable market signals.

## Run Locally

```sh
npm start
```

Open `http://localhost:3000/stocks.html`.

The backend uses Node 22 built-in `node:sqlite`, so no runtime dependencies are required. SQLite data is stored in `server/data/stocks.sqlite`.

## Optional Configuration

Create a local `.env` file if you want Alpha Vantage data:

```sh
ALPHA_VANTAGE_API_KEY=your_key_here
SEC_USER_AGENT="DailySpaceStockSignals/1.0 your-email@example.com"
PORT=3000
```

Without `ALPHA_VANTAGE_API_KEY`, quotes fall back to Yahoo Finance chart data and the earnings calendar shows a `sourceUnavailable` status. SEC EDGAR filings and companyfacts use public SEC endpoints.

## Stock Signal Scope

Signals are rule-based and explainable:

- Quote momentum and stale-data checks
- SEC filing awareness
- Revenue and diluted EPS growth from SEC companyfacts when available
- Earnings-event volatility warnings when an event provider is configured

Signals are for research only and are not investment advice.

## API Endpoints

- `GET /api/stocks/search?q=AAPL`
- `GET /api/watchlist`
- `POST /api/watchlist` with `{ "symbol": "AAPL" }`
- `DELETE /api/watchlist/AAPL`
- `GET /api/stocks/AAPL/summary`
- `POST /api/stocks/AAPL/refresh`

## Test

```sh
npm test
```
