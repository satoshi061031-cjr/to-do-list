# Daily Space

Quiet glass productivity workspace for personal focus — tasks, planner, calendar, tally, light invite/assign, mail digest, and an optional AI agent.

Live app: start at `/todo.html` (PWA start URL). Welcome screen: `/` or `/index.html`.

## What you get

| Surface | Role |
|---|---|
| **Todo** | Daily Loop hub — due today, overdue, assigned, today’s reminders. Phone Today is a single list plus add field. |
| **Calendar** | Month + day panel; add tasks for a day; reminders |
| **Planner** | Personal / team boards (flow); Board + This week by due date |
| **Teamwork** | Private notes on-device + light invite so you can assign from Planner |
| **Tally** | Expense log; spent today also shows in Evening review |
| **Mail** | Sign in → connect mailbox → digest → add to Today (batch select supported) |
| **Agent** | Optional helper for Todo/today and other modules (needs LLM key) |

**Sign-in flow:** Menu → Sign in (Google / Outlook) for cloud sync, mail, and calendar. Guest mode works locally until you sign in to save.

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
2. Run `supabase/migrations/001_user_snapshots.sql`, then `supabase/migrations/005_snapshot_revisions.sql` in the SQL Editor. For an existing project, apply `005` **before** deploying the revision-aware server. It preserves existing snapshots and grants the atomic write function only to `service_role`.
3. Set on Render (and locally):

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never expose the service role key in the browser. Without Supabase, the server falls back to SQLite.

Personal snapshot writes require `baseRevision` (0 for first creation); GET and successful PUT return the current `revision`. A stale write returns HTTP 409 with `code: SNAPSHOT_CONFLICT`, and the app keeps local edits until you choose **Keep this device** or **Use cloud**. Missing revisions return HTTP 428 so old cached clients cannot silently overwrite new data; refresh those clients. SQLite schema upgrades run automatically at startup. Supabase needs the SQL migration above.

Supabase currently stores **personal snapshots only**. Mail token records, shared workspaces/boards, notifications, and shared trips still use SQLite. Supabase does not remove their need for persistent disk and backups.

## Environment

Copy `.env.example` → `.env`. Important variables:

| Variable | Purpose |
|---|---|
| `MAIL_OAUTH_BASE_URL` | Public origin for OAuth callbacks (`http://localhost:3000` locally; `https://….onrender.com` in prod) |
| `GOOGLE_OAUTH_*` | Google login + Gmail mail OAuth |
| `MICROSOFT_OAUTH_*` | Outlook login + mail OAuth |
| `MAIL_TOKEN_ENCRYPTION_KEY` | Encrypt mail tokens at rest (`openssl rand -base64 32`) |
| `GROQ_API_KEY` or `OPENAI_API_KEY` | Todo Agent + Mail inbox AI digest |
| `SUPABASE_*` | Cloud user snapshots |
| `CAPACITOR_SERVER_URL` | Native shell loads this HTTPS origin |

Sign-in with Google or Outlook requests identity, mail, and calendar together. Returning users only pick an account unless mailbox or calendar access is missing.

### Useful API routes

- Auth: `/api/auth/me`, Google / Outlook start + callback
- Calendar: `/api/calendar/events` (Google / Outlook calendar for the signed-in account)
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
2. The existing `render.yaml` uses Render's free plan with ephemeral filesystem storage. For production SQLite data, choose a service plan supporting a persistent disk in Render settings, mount it at `/var/data`, and set `DAILY_SPACE_DB_PATH=/var/data/daily-space.sqlite`. This requires a paid plan; the repository does not activate or purchase it. Before changing paths, back up the existing database and restore it onto the persistent disk. Otherwise the new path starts an empty database. Run only one service instance against this SQLite database; horizontal scaling needs a shared database architecture.
3. Set `MAIL_OAUTH_BASE_URL` to the Render HTTPS URL.
4. Set the same OAuth redirect URIs in Google and Microsoft consoles.
5. Set `GROQ_API_KEY` for Agent + Mail digests.
6. Optional: `ALERT_WEBHOOK_URL` for critical error pings.

## Phone task interaction

The phone Today page has one New task action above the tab bar. Tap a task's text to edit details, or its checkbox to complete it. New and edit share a bottom sheet with date shortcuts and folded time/category/repeat settings. After adding, the sheet stays open for the next entry; editing saves and closes it. Closing or returning preserves a device-local draft, scoped to the signed-in account (or guest); drafts are not cloud snapshots. Delete is in task details and offers Undo. The completed tab and scroll position are remembered for the tab session. The editor follows `visualViewport`, hides navigation while open, and blocks submissions during IME composition.

## Database backup and recovery

Use the same database path as the running server. The backup command reads process environment variables, not `.env`; export `DAILY_SPACE_DB_PATH` explicitly when it is customized. Its default is `server/data/daily-space.sqlite`.

```sh
# Create the destination directory outside the public checkout and restrict access.
mkdir -p /var/data/backups
chmod 700 /var/data/backups
DAILY_SPACE_DB_PATH=/var/data/daily-space.sqlite npm run db:backup -- /var/data/backups/daily-space-2026-10-10.sqlite
```

Use a unique filename for each backup. The command makes a consistent SQLite copy (including committed WAL transactions), verifies `PRAGMA integrity_check`, uses file mode 0600, and refuses to overwrite an existing file. A backup contains private account data; keep it off public file hosting and copy it to protected storage outside the service disk. Schedule the command with your deployment platform's job mechanism and test recovery periodically. This command does not back up Supabase or browser-only `localStorage` data; use Supabase backups and account data export for those separately.

To recover, stop the service, preserve the current database and its `-wal`/`-shm` companions, and copy the verified backup to a **new database filename** on the persistent disk. Set `DAILY_SPACE_DB_PATH` to that new file and restart; do not restore over an active database or reuse its old WAL files. Verify health, signed-in workspace/trip data, and `/api/user/snapshot` before resuming writes.

## HTTP access and Agent limits

Only the client files listed in `server/public-assets.js` are served publicly; Capacitor uses the same list. Add new public client assets there. Configuration, database, source server, tests, and dependency files are not public resources.

Both Agent routes share per-process limits: 20 requests per user (or guest connection IP) per minute, 60 per connection IP, 100 total per minute, and 4 simultaneous calls. Responses exceeding a limit use HTTP 429 and `Retry-After`. Guest Agent usage remains available. Limits use the actual socket address; spoofed `X-Forwarded-For` headers do not bypass them. Behind a reverse proxy, clients may share the proxy IP budget. Multi-instance deployments need a shared limiter and explicit trusted-proxy configuration before relying on per-user/IP quotas.

## Test

```sh
npm test
npm run test:e2e   # HTTP critical-path smoke against a local server
```

`npm run test:ui` runs Chromium interaction tests for stable task rows, editing focus, modal keyboard navigation, touch targets, narrow layouts, and reduced motion. Install Chromium separately; `playwright-core` is a locked development dependency and does not download a browser. The default executable is `/usr/bin/chromium`; set `CHROMIUM_PATH` to override it. In an isolated container where Chromium's sandbox is unavailable, run `CHROMIUM_NO_SANDBOX=1 npm run test:ui`. The suite starts its own server and temporary SQLite database; it does not require OAuth/AI keys. Phone checks emulate viewport and touch input in Chromium, not physical iOS/Android keyboards.

## Legacy note

Stock-watchlist API routes and the scheduler are **removed** from the product server. Unused SQLite stock tables may still exist in the local DB file; they are inert.
