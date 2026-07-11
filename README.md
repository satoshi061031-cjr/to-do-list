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

### Mail OAuth Endpoints

- `GET /api/mail/accounts`
- `DELETE /api/mail/accounts/:id`
- `POST /api/mail/accounts/manual` with `{ "provider": "other", "email": "name@example.com" }`
- `POST /api/mail/accounts/icloud` with `{ "email": "name@icloud.com", "appPassword": "xxxx-xxxx-xxxx-xxxx" }`
- `POST /api/mail/oauth/start` with `{ "provider": "gmail" | "outlook", "email": "name@example.com", "returnTo": "/mail.html" }`
- `GET /api/mail/oauth/google/callback`
- `GET /api/mail/oauth/outlook/callback`
- `GET /api/mail/accounts/:id/messages?limit=20` (recent inbox summaries)

### User Google Sign-In Endpoints

- `POST /api/auth/google/start` with `{ "returnTo": "/todo.html" }`
- `GET /api/auth/google/callback`
- `POST /api/auth/meta/start` with `{ "returnTo": "/todo.html" }`
- `GET /api/auth/meta/callback`

To enable real Gmail/Outlook authorization, copy `.env.example` to `.env` and fill:

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`
- `MAIL_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`)
- `MAIL_OAUTH_BASE_URL` for production domain

iCloud real connection uses Apple app-specific password with IMAP login verification against `imap.mail.me.com:993`.

## Test

```sh
npm test
```
