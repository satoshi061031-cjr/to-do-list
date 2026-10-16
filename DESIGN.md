---
version: alpha
name: Daily Space
description: Minimal productivity workspace inspired by Luma — monochrome surfaces, open lists, system typography, restrained frosted navigation, and a small yellow brand accent.
colors:
  primary: "#171717"
  on-primary: "#ffffff"
  secondary: "#686868"
  tertiary: "#e5c235"
  on-tertiary: "#171717"
  tertiary-deep: "#c9a91c"
  neutral: "#ffffff"
  surface: "#f5f5f5"
  panel: "#ffffff"
  surface-dark: "#161616"
  panel-dark: "#1d1d1d"
  neutral-dark: "#000000"
  text-dark: "#f5f5f5"
  muted-dark: "#999999"
  text: "#171717"
  text-muted: "#686868"
  accent: "#686868"
  accent-soft: "#eeeeee"
  danger: "#a64b45"
  success: "#5a6b58"
  glass-border: "#ffffff14"
  highlight: "#e5c235"
typography:
  display:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  title:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body-md:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label-caps:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 0.875rem
    fontWeight: 600
    letterSpacing: 0
  phone-display:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  phone-title:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  phone-task:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  phone-body:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  phone-meta:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  phone-action:
    fontFamily: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif
    fontSize: 0.9375rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
rounded:
  sm: 12px
  md: 18px
  lg: 28px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 18px
  lg: 28px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: 12px
    typography: "{typography.body-md}"
  button-primary-hover:
    backgroundColor: "{colors.text-muted}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    padding: 12px
  card-glass:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 20px
  liquid-glass:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 20px
  glass-edge:
    backgroundColor: "{colors.glass-border}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  page-shell:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text}"
  caption:
    textColor: "{colors.text-muted}"
    typography: "{typography.label-caps}"
  input-bubble:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 12px
  kicker:
    textColor: "{colors.text-muted}"
    typography: "{typography.label-caps}"
  danger-action:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  success-badge:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  border-quiet:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
  editor-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  reading-surface-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.md}"
  editor-panel-dark:
    backgroundColor: "{colors.panel-dark}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.lg}"
  brand-mark:
    backgroundColor: "{colors.highlight}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.pill}"
  brand-mark-pressed:
    backgroundColor: "{colors.tertiary-deep}"
    textColor: "{colors.on-tertiary}"
  dark-page:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.text-dark}"
  dark-caption:
    textColor: "{colors.muted-dark}"
    typography: "{typography.phone-meta}"
---

## Visual direction

The user supplied Luma as the visual reference: simple, restrained, monochrome. This supersedes the previous photographic mist and liquid-glass direction. Use plain black or white page backgrounds, text hierarchy, open lists, and generous section spacing. Keep the yellow brand token for a small identity mark; primary actions use contrasting monochrome fills. No photographic backgrounds, decorative gradients, glowing edges, hover-following decoration, or card around every item. Preserve the existing productivity workflows and Daily Space identity.

## Colors and depth

Map the light palette and the explicit dark color tokens through the same CSS roles. Light pages use neutral white with ink text and secondary gray; dark pages use neutral-dark black, text-dark, and muted-dark. Cards requiring containment use surface or surface-dark. Editors use panel or panel-dark. Thin separators derive from text at 8% opacity. The phone dock uses a Luma-inspired frosted surface: 72% surface opacity, 28px backdrop blur with 1.15 saturation, a subtle monochrome 6% top tint, a 14% text-derived border, and one quiet shadow. Its active capsule uses neutral at 56% opacity; inactive dark labels mix muted-dark 70% with text-dark 30% for readability over the blurred content. Content lists have no backdrop blur or drop shadow. Modal sheets retain one quiet elevation shadow. Success and danger are semantic, accompanied by checked state, strikethrough, or explicit labels.

## Typography

Use the system font stack on both phone and desktop. Display is 32px/600, section and sheet title 24px/600, task title 16px/500, body and input 16px/400, metadata 14px/400, actions 15px/600. Zero extra tracking. Use sentence case, readable CJK fallbacks, and tabular time and amount numerals. Phone inputs remain 16px to avoid focus zoom. Do not download platform fonts.

## Layout and shapes

Desktop rail and workspace share a centered `min(1120px, 92vw)` boundary with spacing.lg gaps. Reading columns cap at 48rem; Calendar, Planner, and Teamwork use the remaining width. Phone uses spacing.md horizontal padding, spacing.lg between sections, open rows with a 72px minimum and spacing.sm vertical padding. Long titles wrap and grow naturally. Metadata starts underneath the title. Empty space is intentional.

Use rounded.sm for input controls and contained board cards, rounded.md for module panels, rounded.lg for sheets, and rounded.pill for compact actions and navigation. Task and reminder lists use open rows, with only a subtle separator where it helps. Avoid nested rounded boxes. Selectors use quiet text or monochrome selection; no yellow filled navigation.

## Navigation and interactions

New sign-in choices are Google and local Guest only. Show the same choices on the welcome page, account dialog and guest reminder. Guest continues without OAuth or cloud writes and keeps local data. Do not expose Outlook or WeChat sign-in buttons. Existing account data and linked mailboxes remain available; Mail offers new Google connections only.

Desktop keeps the rail stuck to the viewport with theme and language at its foot. Phone keeps one centered fixed dock (Today / Calendar / Tally / More), with theme and language inside More. Active dock items use clear text on one moving neutral capsule. Horizontal dragging inside the dock previews a destination with the capsule following the finger; release activates the nearest control once. Vertical motion, pointer cancellation, focus loss, or releasing well outside the dock restores the current selection. Dragging to More opens the drawer, and closing it returns the capsule to the current page. Plain clicks and keyboard activation remain native; modified link clicks open normally. Keep the dock touch-action as pan-y/pinch-zoom so vertical scrolling remains available. A valid cross-page navigation carries only its temporary capsule position to the destination for a 220ms slide, with a restrained 160ms/8px page entrance. Respect reduced motion by switching instantly while keeping the gesture. Keep all interactive targets at least 44px and preserve safe-area padding. One action cluster per page region; no overlapping corner controls.

Today phone keeps title, date and remaining count, To do / Completed tabs, separate completion controls and task detail actions. A compact bottom New task action stays above the dock within thumb reach. Use the original welcome-sticker.png ghost mark for the assistant. The bottom editor retains title, date shortcuts, folded category/time/repeat, saved drafts, consecutive entry, IME handling, keyboard-safe Save, and Back-to-close. Hide dock and capture while editing. Delete remains in details with Undo.

Desktop Today keeps a visible composer and Ask agent trigger. Calendar desktop keeps the week grid and inline forms. Phone shows its stable Calendar title, compact week strip and selected day agenda; local filters live in a disclosure and one Add to this day action sits above the dock. The task/reminder editor reuses the existing forms inside a keyboard-safe sheet with a fixed Save footer, draft restoration and Back-to-close. Show a reminder once when its linked Todo also exists; keep orphaned linked tasks visible. Tally phone leads with today’s total and recent records. Quick entry and weekly insights use disclosures; CSV export and budget settings live in More. One Add expense action sits above the dock, and its editor preserves drafts, closes on Back and keeps Save visible above the keyboard. Selected month and personal/shared view stay in session preferences scoped to the current identity. Planner phone shows one status at a time and uses explicit move controls; desktop retains the four-column board. Shared Teamwork and device-only notes retain distinct labels and a quiet dashed separator. Mail uses an aligned vertical reading column with a compact title, account picker, refresh and notification icons, and More menu for PDF import and mailbox management. Inbox rows remain open: sender and time, a two-line subject and one-line preview, without inline action buttons. Today’s digest starts collapsed and shows up to three points, with the full summary available inside. Unavailable summaries use quiet text. Tapping a message opens a keyboard-accessible reader sheet with summary, preview, Gmail original link, contextual booking import and one primary Add to Today action. Select mode reveals checkboxes and a batch bar above the phone dock; leave enough scroll space for the last row. Refresh preserves the inbox, digest and selection while pending or failed. In-memory caches are scoped to each mailbox and cleared when the user changes or signs out. Guest Mail has one Gmail prompt and Google sign-in action. Center its envelope mark, title, short explanation and action horizontally, placing the group slightly above the midpoint between the header and phone dock. Use plain page space rather than a contained card; keep the header in place and let short screens scroll. Apply this layout only while no readable mailbox is connected, including the signed-in mailbox authorization prompt. Travel keeps a stable title and trip/day metadata. On phone, Itinerary / Map switches expose either the day’s stops or the map and place search. Desktop keeps the contained map and stop panel below the shared header; storage/sharing explanations use a disclosure. Do not remove controls merely to simplify the first screen.

Every app page uses a stable page title, quiet context and one header action cluster for workspace search, notifications and page-specific More actions. The Agent entry always occupies the top trailing corner of this cluster on both phone and desktop, including Travel. Use the same 44px round monochrome button and original welcome-sticker.png ghost mark everywhere, with the mark sized to spacing.lg; reserve its space while other actions wrap on narrow screens. Keep one entry per page and do not mount it in the navigation dock or desktop rail. Its expanded state reflects the shared dialog, and closing restores the actual opening control. Agent uses one history entry: Back closes it before leaving the page, Forward reopens it with unsent text, and late replies do not take focus from the page. Reuse Mail’s notification placement throughout. Keep 32px page headings and 44px action targets; do not let page-specific typography override these roles. Guest save prompts stay compact below the header. Avoid startup focus changes that scroll users away from the title.

Workspace search links carry the specific task, reminder, expense, card/board or trip ID. Select its date, month, board and column before opening or highlighting it. Search results show linked reminders and project cards once through their source record; if the source no longer exists, retain the linked task. Missing targets show a quiet status while keeping search available. Keep user content as text and preserve URL encoding for IDs. Undo clears every visible bottom action bar as well as the dock.

Task details disclose notes and a checklist without filling the main list with extra controls. Show only note presence and completed/total checklist progress in the row. Phone extends its existing draft-preserving editor; desktop opens one focus-trapped details panel. Source links use quiet text. Alert postponement uses explicit 10-minute/tomorrow labels and leaves the task deadline intact.

Todo multi-selection starts with Select above the list, shows separate selection checkboxes and the visible-list select-all state, and hides completion/edit/delete controls until selection ends. Its single contained batch bar sits above the phone dock; hide New task and leave room to scroll the final row. Complete and Tomorrow remain directly available, with date/category choices disclosed. Changes have Undo, positioned above the batch bar. Guest reminder status explicitly describes the page-open requirement; background push is an opt-in Google device setting and must show unconfigured/error states.

Task templates and import/backup open in one keyboard-safe sheet with a fixed action footer, Back-to-close and account-scoped template drafts. Today keeps Select above the list and places a quiet Templates action beside phone New task or after the desktop composer. Import & backup stays in the account dialog and Tally More. Template choices have a visible check as well as their pressed state; New template is a secondary list action and the footer emphasizes only Add these tasks. The batch disclosure can save selected tasks as a template. Preview counts before merging; display validation errors as text and keep existing records by ID.

Expense capture leads with amount, category and date. Notes, trip, expense type, currency, exchange rate and participants live in More options. Restore that disclosure when a draft or existing record contains notes, a linked trip, shared participants or foreign currency. Keep validation errors reachable and all existing editing controls available. Exchange-rate responses apply only to the current identity, editor, currency and date. Cancel outdated requests and protect manual rates. Clear the prior rate when its context changes; wait for a valid automatic or manual rate before saving a foreign expense. Opening and closing the task, calendar, expense and workspace tool sheets share small translations and fades (180ms in, 160ms out); keep focus isolation until the exit completes and switch instantly for reduced motion. Modal backdrops use neutral-dark at 42% in light mode and 64% in dark mode, without backdrop blur. Never brighten a dark page behind its sheet. Disclosure rows show a directional chevron alongside their text.

Travel expenses use one disclosure in the itinerary, with a total, selected-day spend, optional budget and open category rows and a disclosed ledger record list. Link to the user's own ledger with an explicit privacy label; sharing a trip does not share financial data. Expense capture has an optional Trip selector. Missing trips retain an editable saved link, and expense deep links open the correct month and editor. Use saved exchange rates and the ledger's base currency for all totals. Refresh amounts and records without rebuilding the whole expense disclosure for the same trip and identity; preserve expanded records, focused inputs, unfinished budget edits and scroll position.

## Motion and accessibility

Use brief opacity or small translation transitions, without scaling content cards or glowing hover states. Keep keyboard focus clearly visible with the text token and an outline; never remove focus feedback. Honor reduced motion (dock blur reduces to 16px) and reduced transparency (solid surface with no blur). Browsers without backdrop-filter receive a solid dock. Apply the same dock to the explicit phone shell on wide preview windows; desktop rails retain solid surfaces. Preserve modal focus traps, scroll locking, account-scoped drafts, and Undo. No new blocking confirmations for reversible deletions.

## Implementation

Use tokens from this file for colors, typography, spacing, and radii. Shared presentation lives in visual-refinement.css, loaded after page styles. Keep page behavior in the existing vanilla JS modules. Changes apply equally to light and dark modes and do not force a theme on existing users.
