# Daily Space

Quiet glass productivity workspace for personal focus — tasks, planner, calendar, tally, light invite/assign, mail digest, and an optional AI agent.

Live app: start at `/todo.html` (PWA start URL). Welcome screen: `/` or `/index.html`.

## What you get

| Surface | Role |
|---|---|
| **Todo** | Daily Loop hub — due today, overdue, assigned, today’s reminders. Phone Today is a single list plus add field. |
| **Calendar** | Desktop week grid; phone day agenda and task/reminder sheet with drafts and Back-to-close |
| **Projects / Planner** | Personal and team boards; phone status columns; direct links to cards |
| **Teamwork** | Private notes on-device + light invite so you can assign from Planner |
| **Tally** | Today’s spend and recent records; optional quick entry/insights, More tools, expense editor drafts |
| **Mail** | Open inbox rows → message reader → add to Today; collapsed digest, explicit batch selection, booking/PDF import |
| **Agent** | Optional helper for Todo/today and other modules (needs LLM key) |

**Sign-in flow:** Menu → Sign in with Google for cloud sync, Gmail, and calendar, or Continue as guest for device-local use. The welcome page and account dialog offer the same two choices. Outlook and WeChat cannot start a new sign-in; existing account data and linked mailboxes are retained.

Guest mode works locally with `localStorage`; mail, cloud sync, and workspace invites need a signed-in session.

## Reliability

- **Cloud sync:** offline edits stay on-device; when local and cloud diverge, Account shows **Keep local** / **Use cloud** (nothing overwrites until you choose).
- **Account data:** signed-in users can **Download my data** or **Delete account** from Account (removes cloud snapshot + mail tokens, then signs out).
- **Mail:** refresh keeps messages, digest and selection visible while loading or failed. Mailbox caches stay separate and clear when the user changes or signs out. The reader shows a preview with a Gmail original link; relevant messages offer booking import. PDF import and mailbox management live in More. Unavailable AI summaries use a quiet notice inside the collapsed digest.
- **Alerts:** set `ALERT_WEBHOOK_URL` to receive a POST JSON ping on server 500s / unhandled errors.
- **Smoke:** `npm test` covers today task → calendar-visible due date → mail-shaped `todo_add`, plus account delete/export helpers.
- **Browser interactions:** `npm run test:ui` checks desktop and phone controls, modal focus, Mail selection/retry/account isolation and duplicate task prevention. Set `CHROMIUM_PATH` if Chromium is installed outside `/usr/bin/chromium`.

All pages share a compact title, workspace search, notifications and page tools. Workspace search opens the matching task, dated reminder, expense month/editor, project board/card or trip. Linked reminders/cards appear once, and missing targets leave the page usable. Calendar filters, Tally month/view and editor drafts use session preferences scoped to the current Google account or Guest. On phone, Travel offers Itinerary / Map views.

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
| `MICROSOFT_OAUTH_*` | Optional legacy linked-mailbox OAuth; not a new sign-in provider |
| `MAIL_TOKEN_ENCRYPTION_KEY` | Encrypt mail tokens at rest (`openssl rand -base64 32`) |
| `GROQ_API_KEY` or `OPENAI_API_KEY` | Todo Agent + Mail inbox AI digest |
| `SUPABASE_*` | Cloud user snapshots |
| `CAPACITOR_SERVER_URL` | Native shell loads this HTTPS origin |

Sign-in with Google requests identity, mail, and calendar together. Returning users only pick an account unless mailbox or calendar access is missing.

### Useful API routes

- Auth: `/api/auth/me`, Google start + callback; old Outlook/WeChat start endpoints return HTTP 410
- Calendar: `/api/calendar/events` (Google calendar, plus previously linked accounts)
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

## Task details and batch actions

Open a task on phone or use its **Task details** button on desktop to save notes and a checklist. Drafts survive Back/reload and are scoped to the current account or Guest. Checklist progress appears quietly in the task row; completing the main task does not automatically check its subtasks. Repeating tasks copy the note and create a fresh, unchecked checklist. Mail tasks link to the original Gmail thread when added with this version; older mail tasks return to Mail. Linked calendar and project tasks return to their source.

Use **Select** above the task list to select individual tasks or the visible list. **Complete**, **Tomorrow**, or the disclosed **Date & category** controls apply only to the selection. Batch changes have Undo, including any next occurrences created by completing repeat tasks. Assigned/shared tasks continue to use their existing collaboration controls.

## Reminders and background push

The **Reminders** disclosure below Todo, or beside Calendar's reminder control, shows the actual device status. Google users can opt in to Web Push. Reminders are stored in SQLite and sent by the running server every 15 seconds, independent of an open browser page. Timed tasks/reminders use their time; untimed dated tasks use 19:00 in the device's time zone. Completing/deleting a task removes its pending job after account sync. A linked calendar reminder appears once and stops notifying when its task is completed.

Notification actions offer **10 minutes later** and **Tomorrow** (09:00 in the recorded time zone), without opening the page. Task details offer the same postponement controls. Postponement changes the next alert rather than the task deadline. Actions on removed/rescheduled reminders expire. Jobs retain their delivered/postponed state across normal reloads and server restarts; transient delivery failures retry up to three times and dead device subscriptions are removed. Sign-out or account deletion revokes that account's background reminders and subscriptions; other devices will need to opt in again.

To enable production Web Push:

1. Generate a key pair with `npx web-push generate-vapid-keys --json` in a private terminal. Set `VAPID_PUBLIC_KEY`, **`VAPID_PRIVATE_KEY`**, and `VAPID_SUBJECT` (your real `mailto:` contact or HTTPS support page) in secure deployment environment settings. Keep the key pair stable across deployments. Never commit the private key.
2. Use HTTPS, an **always-running server**, and a persistent `DAILY_SPACE_DB_PATH`; this scheduler supports one Node service instance. The default Render free Blueprint sleeps and has ephemeral storage, so adding keys alone does not make it a reliable reminder service. Configure the hosting plan/disk yourself; the repository does not activate paid hosting.
3. Sign in with Google, wait for account sync, then open **Reminders → Enable reminders** on each device and grant notification permission. On iPhone/iPad, Web Push requires iOS/iPadOS 16.4+ and adding the site to the Home Screen. The Capacitor shell does not gain native local notifications from this Web Push implementation.
4. Test a future timed task, close the page, and confirm delivery and both postponement actions on the actual device. Automated checks exercise scheduling, encryption, ownership, cancellation and service worker actions, but do not send real provider pushes or validate physical OS delivery.

Guest reminder data stays local and is never uploaded to the push API. Guest and unconfigured-server fallbacks alert only while a page is running; the UI states this limit. Browser permissions, OS notification settings, connectivity and hosting uptime still govern delivery. Offline edits must finish account and reminder sync before closing the page; the UI reports a failed schedule update. Local notification postponement reopens the page to save locally. Notification action buttons vary by browser; use task details when unavailable.

Pending reminders/device subscriptions use SQLite even when personal snapshots use Supabase. Include them in the existing SQLite backup/recovery process. Only the configured public VAPID key is exposed to the client; private credentials and action capabilities are never cached as API responses.

## Deploy (Render)

1. Connect the GitHub repo; use `npm start` (or your existing Render Blueprint).
2. The existing `render.yaml` uses Render's free plan with ephemeral filesystem storage. For production SQLite data, choose a service plan supporting a persistent disk in Render settings, mount it at `/var/data`, and set `DAILY_SPACE_DB_PATH=/var/data/daily-space.sqlite`. This requires a paid plan; the repository does not activate or purchase it. Before changing paths, back up the existing database and restore it onto the persistent disk. Otherwise the new path starts an empty database. Run only one service instance against this SQLite database; horizontal scaling needs a shared database architecture.
3. Set `MAIL_OAUTH_BASE_URL` to the Render HTTPS URL.
4. Set the Google OAuth redirect URIs in the Google console.
5. Set `GROQ_API_KEY` for Agent + Mail digests.
6. Optional: `ALERT_WEBHOOK_URL` for critical error pings.

## Phone task interaction

The bottom dock supports tapping or dragging horizontally to select a page; release switches once, and dragging to More opens the drawer. The selection capsule follows the finger and slides to its resting position. Vertical scrolling and cancelled gestures leave the current page intact; reduced motion keeps gestures but removes the transition.

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
