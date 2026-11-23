# Changelog

All notable changes to dayfly are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). dayfly has no version tags
yet, so each merged pull request is an entry, newest first, dated by its merge.

## [Unreleased]

### Added

- **Recurrence rules:** repeat on weekdays or yearly, every N days/weeks/months, on chosen weekdays, until a date, or counted from completion ("every 2 weeks · Mon, Thu"). The task editor, the app, the calendar and the MCP server share one rule (`nextOccurrenceDate` in `task-fields.js`).
- **Tags** on tasks (up to 10), edited in task details and shown as chips.
- **Natural-language quick add** in English and Chinese: relative days, weekdays, dates, times ("下午3点一刻", "7pm"), repeats, `#tag` or category, and `!!` / `!3` priority, previewed as an Apply chip.
- **Voice input** for quick add where the browser supports speech recognition.
- **Eisenhower matrix** view of tasks (important = high priority or Top 3; urgent = due by tomorrow).
- **Calendar time-blocking:** drag a task or reminder into an hour on the week grid (15-minute snap, live preview, Undo) or move it with Alt+arrow keys. Timed tasks appear as blocks, and overlapping items sit side by side.
- **Habit tracker** page: daily check-ins, a seven-day strip per habit, streaks and a 12-week heatmap.
- **Tally insights:** spending charts, likely subscriptions (the same merchant charged about monthly), and receipt scanning with a vision model (`AGENT_VISION_MODEL`) that pre-fills the expense form.
- **MCP server** at `/api/mcp`, so Claude, ChatGPT and other assistants can list and change tasks, expenses and reminders with a personal key (Toolbox → Connect an AI assistant).
- **Engineering:** GitHub Actions CI (lint, unit and UI tests), ESLint, Dockerfile and docker-compose for self-hosting, README screenshots and this changelog.

### Changed

- Account sync compresses large stores (`gz1:` gzip values), so years of data fit the 1 MB cloud limit instead of about eight months. Old plain values still read normally.
- Calendar events dayfly created in Google Calendar or Outlook now follow their task or reminder: renames and moves update the event, and deletes remove it after the undo window. New routes: `PATCH` / `DELETE /api/calendar/events/:id`.

### Fixed

- Background reminders no longer switch themselves off after a redeploy on a host that wipes its disk: push subscriptions and schedules are mirrored to Supabase (migration `007_reminder_backups.sql`) and restored before any reminder request is answered.
- Reminders on a host that sleeps can be sent on time: `POST /api/reminders/tick` with `REMINDER_TICK_SECRET`, called every 10 minutes by `.github/workflows/reminder-tick.yml` once `DAYFLY_URL` and the secret are configured.
- The Capacitor app schedules reminders on the phone with local notifications, so they fire with the app closed and no server.
- Background reminders arrive on time on Render's free plan: with push configured, the server requests its own public address every 10 minutes, so it is never put to sleep. The GitHub "Reminder tick" schedule turned out to run only every few hours and is now a backup.

## [PR #8] - 2026-11-19

### Added

- Mail shows a ranked "Top N to read" list above the inbox: up to five messages that most need attention, each with a short reason, opening the existing reader. A configured model ranks them; without one, rules score unread, starred, important and category signals plus English and Chinese action words, so promotions stay out.
- Gmail messages carry their label signals, and Outlook messages add read state, importance, flag and Focused/Other. The digest reads the 25 most recent messages.

### Fixed

- Mailbox connections survive a wiped SQLite database: mailbox rows (tokens still sealed) are mirrored to the Supabase table `mail_account_backups` and restored after a redeploy. Requires migration `006_mail_account_backups.sql`; without Supabase nothing changes.
- When Google sign-in returns without a refresh token and none is stored, dayfly asks Google once more for consent for the same account. Declining still completes the sign-in.

## [PR #7] - 2026-11-19

### Fixed

- Phone sheets that focus an input (New task, task details) keep their opening animation when the keyboard resizes the viewport, instead of popping in. Height-only viewport changes re-aim the morph; width changes still finish it.

## [PR #6] - 2026-11-18

### Added

- Phone Calendar: swipe the week strip to change week and the day agenda to change day; both slide in.
- Phone Tally: swipe a record left to reveal Delete (keyboard focus reveals it too); tapping an open row closes it instead of opening the editor.
- Tasks: long-press and drag to reorder on touch screens; the reorder handle also moves a task with the arrow keys.

### Changed

- Static files are served with brotli/gzip compression and ETag revalidation. Pages reference local scripts and styles as `file.js?v=<hash>`, which are cached immutably for a year.
- The service worker serves versioned scripts and styles cache-first and falls back to a cached page after 3 seconds instead of waiting on a sleeping server.
- Pages reserve their shell, subtitle and save-status space before first paint. On a throttled phone profile, Todo's first paint dropped from 6.7 s to 1.8 s (1.4 MB to 340 KB) and layout shift on Tally from 0.51 to 0.005.
- Smoother motion: Tally budget and weekly bars use transforms, checking a task gives a short pop, and the undo bar slides out and replays its entrance for a second undo.

## [PR #5] - 2026-11-18

### Added

- Currency symbols for MYR, THB, TWD, AUD, CAD, VND and PHP.

### Fixed

- Foreign-currency Tally amounts no longer borrow the ledger's base symbol (a 20.85 MYR expense showed as "CN¥20.85"). Currencies without a known symbol show their ISO code. Stored records and totals were already correct.

## [PR #4] - 2026-11-17

### Changed

- The iPhone home-screen icon is an opaque 180 px ghost on a navy gradient, replacing a transparent icon that iOS filled with black, and pages set the home-screen title to "dayfly". Android and the web manifest keep the transparent icons.

## [PR #3] - 2026-11-16

### Added

- Tally quick add: `POST /api/tally/quick-add` with `Authorization: Bearer <key>` records an expense (amount plus optional category, note, date, currency, fxRate and id) without opening the app, for example from an iOS Shortcut. Create the key in Tally → More options → Shortcut quick add; it is shown once, and replacing or clearing it revokes it.
- Quick-add expenses are written into the account snapshot with the existing compare-and-swap and reach open devices on their next sync. A repeated id is recorded once, and requests are rate limited.

## [PR #2] - 2026-11-16

### Changed

- Task metadata fits on one line on desktop. Due dates read Today, Tomorrow, Yesterday, "N days overdue" or "Nov 20", with the full date as a tooltip.
- Desktop quick add keeps the input, due-date chip and Templates on one line.
- Rail items have distinct icons and labels, and the theme toggle shows a sun or moon.
- Tally and Mail share the common content column, the idle save status reserves a single line, and the reminder settings disclosure is labelled "Reminder alerts".

### Fixed

- The desktop "move to the left edge" hint no longer covers a rail icon.
- Today's date in the Calendar week header and all-day chips use readable ink on their markers.
- On phone, Tally and Calendar content fades out before the capture button and dock; desktop Tally moves Add expense into the header actions.
- Personal project cards no longer show their own title's initials as an avatar; tags render as #tag chips.

## [PR #1] - 2026-11-16

### Changed

- Completing or deleting a task fades the row out and the rows below slide up; deletes now have an exit animation.
- Motion durations and easing come from shared `--motion-*` and `--ease-*` tokens, and a global reduced-motion rule covers transitions without their own override.
- On phone, content fades out before the floating New task button and the dock.

### Fixed

- Monthly repeating tasks clamp to the month end and return to their original day (Jan 31 → Feb 28 → Mar 31) instead of overflowing into the next month. The app, Calendar and Agent share one implementation.

[Unreleased]: https://github.com/satoshi061031-cjr/to-do-list/compare/cd0f405...HEAD
[PR #8]: https://github.com/satoshi061031-cjr/to-do-list/pull/8
[PR #7]: https://github.com/satoshi061031-cjr/to-do-list/pull/7
[PR #6]: https://github.com/satoshi061031-cjr/to-do-list/pull/6
[PR #5]: https://github.com/satoshi061031-cjr/to-do-list/pull/5
[PR #4]: https://github.com/satoshi061031-cjr/to-do-list/pull/4
[PR #3]: https://github.com/satoshi061031-cjr/to-do-list/pull/3
[PR #2]: https://github.com/satoshi061031-cjr/to-do-list/pull/2
[PR #1]: https://github.com/satoshi061031-cjr/to-do-list/pull/1
