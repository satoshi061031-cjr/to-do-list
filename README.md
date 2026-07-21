# Daily Space Stock Signals

This project is a static Daily Space PWA plus a Node 22 backend for a US stock watchlist, public-company filings, event reminders, and explainable market signals.

## Run Locally

```sh
npm start
```

Open `http://localhost:3000/stocks.html`.

The backend uses Node 22 built-in `node:sqlite` for legacy and local-development data. SQLite data is stored in `server/data/stocks.sqlite`.

## Persistent User Workspaces with Supabase

Daily Space keeps `localStorage` as a fast offline cache and stores signed-in users' workspace snapshots in Supabase Postgres.

1. Create a Supabase project.
2. Run `supabase/migrations/001_user_snapshots.sql` in the Supabase SQL Editor.
3. Add these server-only environment variables locally and in Render:

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code. If Supabase is not configured, local development falls back to SQLite. Existing SQLite snapshots are copied to Supabase the first time each user signs in.

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

### User Sign-In Endpoints

- `POST /api/auth/google/start` with `{ "returnTo": "/todo.html" }`
- `GET /api/auth/google/callback`
- `POST /api/auth/outlook/start` with `{ "returnTo": "/todo.html" }`
- `GET /api/auth/outlook/callback`
- `POST /api/auth/wechat/start` with `{ "returnTo": "/todo.html" }`
- `GET /api/auth/wechat/callback`

To enable real Gmail/Outlook/WeChat authorization, copy `.env.example` to `.env` and fill:

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (login + mail; login only asks for `openid email profile`)
- `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` (login + mail; login omits `Mail.Read`)
- Optional later: `GOOGLE_SIGNIN_*` / `MICROSOFT_SIGNIN_*` if you ever split clients
- `WECHAT_OAUTH_APP_ID`, `WECHAT_OAUTH_APP_SECRET` (微信开放平台「网站应用」扫码登录)
- `MAIL_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`)
- `MAIL_OAUTH_BASE_URL` for production domain

Sign-in no longer uses `include_granted_scopes`, so previous Gmail grants should not get pulled into the Google login consent screen. Mail scopes are only requested from the Mail page OAuth flow.

For WeChat website-app login, register the authorization callback domain to match `MAIL_OAUTH_BASE_URL`, and use callback path `/api/auth/wechat/callback`. Local testing needs a public HTTPS tunnel because WeChat only redirects to registered domains.

iCloud real connection uses Apple app-specific password with IMAP login verification against `imap.mail.me.com:993`.

## Mobile app (Capacitor)

Daily Space can run inside a native Android / iOS shell via Capacitor.

1. Install deps (`npm install`) and prepare the web bundle:

```sh
npm run cap:prepare
```

2. Point the shell at your **HTTPS** deploy (same host as `MAIL_OAUTH_BASE_URL`) so login and `/api` keep working:

```sh
export CAPACITOR_SERVER_URL=https://your-app.onrender.com
npm run cap:sync
```

3. Open the native IDE:

```sh
npm run cap:android   # Android Studio
npm run cap:ios       # Xcode (macOS)
```

4. Run on a device/emulator from the IDE, or:

```sh
CAPACITOR_SERVER_URL=https://your-app.onrender.com npm run cap:run:android
CAPACITOR_SERVER_URL=https://your-app.onrender.com npm run cap:run:ios
```

Without `CAPACITOR_SERVER_URL`, Capacitor loads the bundled `www/` files (UI only — OAuth/API need the live URL). Store listing still requires Apple / Google developer accounts and the usual review flow.

## Test

```sh
npm test
```
