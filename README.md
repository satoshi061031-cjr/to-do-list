# Daily Space

Quiet glass productivity workspace for personal focus — tasks, planner, calendar, tally, light invite/assign, mail digest, and an optional AI agent.

Live app: start at `/todo.html` (PWA start URL). Welcome screen: `/` or `/index.html`.

## What you get

| Surface | Role |
|---|---|
| **Todo** | Daily Loop hub — due today, overdue, assigned, today’s reminders |
| **Calendar** | Month + day panel; add tasks for a day; reminders |
| **Planner** | Personal / team boards (flow); Board + This week by due date |
| **Teamwork** | Private notes on-device + light invite so you can assign from Planner |
| **Tally** | Expense log; spent today also shows in Evening review |
| **Mail** | Sign in → connect mailbox → digest → add to Today (batch select supported) |
| **Agent** | Optional helper for Todo/today and other modules (needs LLM key) |

**Sign-in flow:** Menu → Sign in (Google / Outlook / WeChat) for cloud sync and light assign. On Mail, sign in to Daily Space first, then connect a mailbox.

Guest mode works locally with `localStorage`; mail, cloud sync, and workspace invites need a signed-in session.

## Reliability

- **Cloud sync:** offline edits stay on-device; when local and cloud diverge, Account shows **Keep local** / **Use cloud** (nothing overwrites until you choose).
- **Account data:** signed-in users can **Download my data** or **Delete account** from Account (removes cloud snapshot + mail tokens, then signs out).
- **Mail digest:** if AI summarization is unset or fails, inbox still loads with snippet fallback and a clear status line.
- **Alerts:** set `ALERT_WEBHOOK_URL` to receive a POST JSON ping on server 500s / unhandled errors.
- **Smoke:** `npm test` covers today task → calendar-visible due date → mail-shaped `todo_add`, plus account delete/export helpers.

## Install as PWA

- **Chrome / Edge (desktop):** open the app → browser menu → **Install Daily Space** (or the install icon in the address bar).
- **Safari (iPhone/iPad):** Share → **Add to Home Screen**.
- **Android Chrome:** menu → **Install app** / **Add to Home screen**.

Start URL is `/todo.html` (Daily Loop). Account → install tip appears when you are not already in standalone mode.

## Run locally

```sh
cp .env.example .env   # fill OAuth / keys as needed
npm start
```

Open `http://localhost:3000/` or `http://localhost:3000/todo.html`.

Requires **Node 22+** (uses built-in `node:sqlite` for local/dev data when Supabase is unset).

## Persistent workspaces (Supabase)

Daily Space keeps `localStorage` as a fast offline cache and stores signed-in users’ snapshots in Supabase Postgres.

1. Create a Supabase project.
2. Run `supabase/migrations/001_user_snapshots.sql` in the SQL Editor.
3. Set on Render (and locally):

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never expose the service role key in the browser. Without Supabase, the server falls back to SQLite.

## Environment

Copy `.env.example` → `.env`. Important variables:

| Variable | Purpose |
|---|---|
| `MAIL_OAUTH_BASE_URL` | Public origin for OAuth callbacks (`http://localhost:3000` locally; `https://….onrender.com` in prod) |
| `GOOGLE_OAUTH_*` | Google login + Gmail mail OAuth |
| `MICROSOFT_OAUTH_*` | Outlook login + mail OAuth |
| `WECHAT_OAUTH_*` | WeChat website-app QR login |
| `MAIL_TOKEN_ENCRYPTION_KEY` | Encrypt mail tokens at rest (`openssl rand -base64 32`) |
| `GROQ_API_KEY` or `OPENAI_API_KEY` | Todo Agent + Mail inbox AI digest |
| `SUPABASE_*` | Cloud user snapshots |
| `CAPACITOR_SERVER_URL` | Native shell loads this HTTPS origin |

Sign-in requests identity scopes only. Mail scopes (`gmail.readonly` / `Mail.Read`) are requested only from the Mail page OAuth flow.

### Useful API routes

- Auth: `/api/auth/me`, Google / Outlook / WeChat start + callback
- Sync: `/api/user/snapshot`, `/api/user/export`, `DELETE /api/user/account`
- Mail: `/api/mail/accounts`, `…/messages`, `…/digest`, OAuth start/callbacks
- Agent: `/api/agent`, `/api/agent/status`
- Teamwork boards / notifications: under `/api/workspaces`, `/api/me/tasks`, `/api/notifications`

## Mobile (Capacitor)

| Mode | How | What you get |
|---|---|---|
| **Remote shell** | set `CAPACITOR_SERVER_URL` to your HTTPS origin | Full app: OAuth, sync, mail, agent |
| **Bundled `www/`** | leave `CAPACITOR_SERVER_URL` unset | UI smoke only — APIs/OAuth need the live URL |

```sh
npm run cap:prepare
export CAPACITOR_SERVER_URL=https://your-app.onrender.com
npm run cap:sync
npm run cap:android   # or cap:ios
```

## Deploy (Render)

1. Connect the GitHub repo; use `npm start` (or your existing Render Blueprint).
2. Set `MAIL_OAUTH_BASE_URL` to the Render HTTPS URL.
3. Set the same OAuth redirect URIs in Google / Microsoft / WeChat consoles.
4. Set `GROQ_API_KEY` for Agent + Mail digests.
5. Optional: `ALERT_WEBHOOK_URL` for critical error pings.

## Test

```sh
npm test
npm run test:e2e   # HTTP critical-path smoke against a local server
```

## Legacy note

Stock-watchlist API routes and the scheduler are **removed** from the product server. Unused SQLite stock tables may still exist in the local DB file; they are inert.
