# Daily Space

Quiet glass productivity workspace for personal focus and light team assignment — tasks, planner, calendar, tally, teamwork, mail digest, and an optional AI agent.

Live app: start at `/todo.html` (PWA start URL). Welcome screen: `/` or `/index.html`.

## What you get

| Surface | Role |
|---|---|
| **Todo** | Daily Loop hub — due today, overdue, assigned, today’s reminders |
| **Calendar** | Month + day panel; add tasks for a day; reminders |
| **Planner** | Personal / team boards; due today & this week strip |
| **Teamwork** | Shared workspaces, invites, assignment feed (device-only private notes optional) |
| **Tally** | Expense log with spent today / week / month + budget |
| **Mail** | Connect Gmail/Outlook → pull inbox → AI digest → add as today’s task |
| **Agent** | Natural-language actions across Todo / Planner / Calendar / Tally (needs LLM key) |

**Sign-in flow:** Menu → Sign in (Google / Outlook / WeChat) for cloud sync and teamwork. On Mail, sign in to Daily Space first, then connect a mailbox.

Guest mode works locally with `localStorage`; collaboration, mail, and cloud sync need a signed-in session.

## Reliability

- **Cloud sync:** offline edits stay on-device; Account shows `offline` / `failed — will retry` / `kept this device’s changes` when local and cloud diverge after offline work.
- **Mail digest:** if AI summarization is unset or fails, inbox still loads with snippet fallback and a clear status line.
- **Smoke:** `npm test` includes a critical-path check (today’s task → calendar-visible due date → mail-shaped `todo_add`).

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
- Sync: `/api/user/snapshot`
- Mail: `/api/mail/accounts`, `…/messages`, `…/digest`, OAuth start/callbacks
- Agent: `/api/agent`, `/api/agent/status`
- Teamwork boards / notifications: under `/api/workspaces`, `/api/me/tasks`, `/api/notifications`

## Mobile (Capacitor)

```sh
npm run cap:prepare
export CAPACITOR_SERVER_URL=https://your-app.onrender.com
npm run cap:sync
npm run cap:android   # or cap:ios
```

Without `CAPACITOR_SERVER_URL`, the shell loads bundled `www/` (UI only — OAuth/API need the live HTTPS URL).

## Deploy (Render)

1. Connect the GitHub repo; use `npm start` (or your existing Render Blueprint).
2. Set `MAIL_OAUTH_BASE_URL` to the Render HTTPS URL.
3. Set the same OAuth redirect URIs in Google / Microsoft / WeChat consoles.
4. Set `GROQ_API_KEY` for Agent + Mail digests.

## Test

```sh
npm test
```

## Legacy note

Stock-watchlist API routes and the scheduler are **removed** from the product server. Unused SQLite stock tables may still exist in the local DB file; they are inert.
