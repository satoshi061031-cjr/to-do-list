---
version: alpha
name: dayfly
description: Restrained productivity workspace combining Luma open lists with translucent surfaces, geometric Latin typography, coordinated cool-white and navy palettes, and a small yellow identity accent.
colors:
  primary: "#365cad"
  primary-hover: "#2c4d96"
  on-primary: "#ffffff"
  secondary: "#647189"
  tertiary: "#e5c235"
  on-tertiary: "#171717"
  tertiary-deep: "#c9a91c"
  neutral: "#f3f5f9"
  surface: "#eef2f8"
  panel: "#ffffff"
  surface-dark: "#111e35"
  panel-dark: "#172640"
  neutral-dark: "#070d19"
  overlay-ink: "#000000"
  horizon-dark: "#172846"
  depth-dark: "#03060d"
  primary-dark: "#8baaff"
  primary-hover-dark: "#b3c7ff"
  danger-dark: "#dfa6a1"
  success-dark: "#a4bca1"
  text-dark: "#e8eefb"
  muted-dark: "#a5b4d0"
  text: "#172640"
  text-muted: "#647189"
  accent: "#365cad"
  accent-soft: "#e7edf7"
  danger: "#a64b45"
  success: "#5a6b58"
  glass-border: "#ffffff14"
  highlight: "#e5c235"
typography:
  display:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  title:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  body-md:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  label-caps:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 0.875rem
    fontWeight: 600
    letterSpacing: 0
  phone-display:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0
  phone-title:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  phone-task:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  phone-body:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  phone-meta:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  phone-action:
    fontFamily: '"Daily Space Gotham", "Gotham", "Montserrat", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'
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
    backgroundColor: "{colors.primary-hover}"
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
  dark-gradient-top:
    backgroundColor: "{colors.horizon-dark}"
  dark-gradient-bottom:
    backgroundColor: "{colors.depth-dark}"
  modal-overlay:
    backgroundColor: "{colors.overlay-ink}"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.neutral-dark}"
    rounded: "{rounded.pill}"
    typography: "{typography.phone-action}"
  button-primary-hover-dark:
    backgroundColor: "{colors.primary-hover-dark}"
    textColor: "{colors.neutral-dark}"
  danger-action-dark:
    textColor: "{colors.danger-dark}"
  success-badge-dark:
    textColor: "{colors.success-dark}"
---

## Brand

The product name is **dayfly**, always lowercase in both languages. Use it in welcome, browser/install titles, assistant labels, notifications and exported filenames. Keep the original ghost. Existing storage/event keys, database paths, native application identifiers and backup format markers remain compatible; the internal font-family alias `Daily Space Gotham` remains a technical name.

## Visual direction

The user approved the Apple-inspired Obsidian material preview while retaining the current dayfly framework and workflows. Keep the Luma-derived open lists, generous spacing and original ghost identity. Light mode pairs a cool-white background with navy text and restrained blue primary actions; dark primary actions use a lighter cool blue. App pages use one continuous translucent workspace over the theme background; the welcome page keeps its plain entry layout. Use subtle borders and one quiet window shadow, without glowing edges, hover-following decoration, or a glass card around every item. Yellow remains a small identity accent. Primary actions use the same blue role on desktop and phone. Task completion uses a quiet circular checkbox inside a separate 44px target, and expense categories use monochrome line icons rather than emoji. In dark mode, use the user-approved deep navy and cool blue direction inspired by the Odyssey reference without changing the framework or layout.

## Personal workbench

dayfly is a personal workbench for daily work, life and plans. Evolve the existing todo.html and todo-m.html home routes; preserve their task IDs, capture/details controls, links and navigation gestures. Label the home navigation Workbench / 工作台, with My workbench / 我的工作台 as the default page title. The compact English phone dock uses Home to keep the full label readable at 320px. Keep Calendar, Tally and More in the phone dock. The welcome keeps the ghost and Google/Guest choices with the message “Your work, life and plans, together.” Do not restrict accounts merely because the product is personal.

The home header keeps workspace search, one Customize workbench icon and the trailing ghost in a single cluster. Allow long personal titles to wrap and retain the 32px display role. At home widths of 360px or less, use the 24px title role so the full name remains readable beside the action cluster. On the narrowest phones wrap the secondary header actions within their single cluster and reserve the top trailing corner for the ghost, retaining room for the title. The default reading order is a compact next appointment today, the original task list, quiet common-tool links, a single-line personal spending total and an active trip summary. Show the next appointment only when one exists and trips only while active; derive amounts from the ledger’s saved exchange rates and base currency. Do not fetch full inboxes or initialize maps on home. Full reminder information follows the task list. The same task must never be copied into a separate home store.

Customize workbench is an existing-style keyboard-safe sheet with name, display name, section visibility/order and up to four common tool links. Tasks remain visible. Use explicit 44px up/down controls and labelled checkbox targets; keep Save in a fixed footer and body content scrollable. Back closes before leaving and preserves unfinished changes for reopening within the page; account changes clear that draft. Hide the dock/capture while customizing and retain modal isolation and focus restoration. Reuse the existing title/body/meta/action tokens, open task rows and fine separators. Desktop summary groups follow the widget layout below; editors keep the shared sheet design.

Personal home configuration belongs to the loaded account/Guest workspace and uses the normal snapshot synchronization, export, backup and recovery paths. Existing session-only reading preferences remain separate. Failed device writes keep the settings sheet and edits visible; unloaded or locked workspaces reject changes. Legacy snapshots without home preferences receive defaults without creating a false conflict. Shared collaboration remains available in its existing tools; personal counts and layout choices are private.

## Desktop widget layout

The user approved a stacked widget layout for the desktop workbench while explicitly retaining the current fonts and colors. At desktop widths, fill a wider shared material window with a compact overview grid above the original task composer/list: today’s task counts and actual completion progress, the next timed arrangement, one existing task to focus on, and a quiet spending/common-tools band. Use only the existing panel/surface/text/primary roles in both themes, the current font stack and typography scales, spacing tokens and large sheet rounding. Do not import the reference’s yellow/orange palette, product imagery or inventory labels.

The overview uses summaries from the existing stores, never a second task collection or invented chart data. Its execution card makes Start focus the primary action when available, while the title or quiet details action opens the original task. Timing remains optional; empty states invite normal task entry or Calendar. Respect the existing home section visibility choices and common links; auxiliary link order follows personal configuration. The full task list follows the desktop overview, and active trips remain in their original section. Keep the desktop grid isolated from the phone widget layout and its configurable section order, including explicit todo-m.html on wide preview windows. No inbox or map fetch is added. Keep overview content keyboard accessible, clear it when the workspace is not ready, and retain the header ghost and settings positions.

## Phone widgets and schedule layout

The user approved compact phone overview tiles, grouped task/appointment cards and a calendar date selector inspired by the supplied mobile references, explicitly keeping the current fonts and colors. Reuse the existing Gotham/Montserrat/native stack, typography roles, white/navy surfaces and blue primary actions. Do not import the references’ purple, peach or green colors, fake avatars, meeting platforms or activity records.

Phone Workbench defaults to a compact summary of actual open tasks today and the next real timed arrangement, with a clear empty-day state. An explicit overview toggle reveals the original two-by-two tiles for tasks, reminders, personal projects and private base-currency spending; remember this choice in the existing personal home preferences. Do not reshuffle the page whenever a count changes from zero. Keep the full tiles available and continue to respect configured section visibility. Task activation resets the original list to personal/active/today and clears category filtering without creating new tasks or opening the keyboard. Other tiles link to Calendar today, Projects and Tally. Home preferences hide the associated schedule, spending and pinned-project tiles; Tasks remains available. Respect workspace readiness, clear private counts on account transitions, keep existing section order and update counts in place. Task cards use quiet surface fills, thin borders and rounded.md, with separate 44px completion targets, original details/drafts/Undo and optional swipe actions.

On phone widths at most 360px in windows at most 640px high, reduce only secondary introduction and blank reserved space, use spacing.sm between primary regions, and shorten the compact summary while keeping 44px controls and existing type roles. Never hide an actual storage/sync error or its retry control. Keep task text and completion targets clear of the fixed New task action.

Phone Calendar keeps its compact week strip. The existing month label toggles a six-week month picker with real dated activity dots, previous/next month, keyboard navigation and a minimum 44px target for every date. Seven columns still fit 320px by extending the grid within the page’s safe margins; selected dates keep on-primary text even when browsing an adjacent month. While expanded, keep month dates above the dock using scroll margins and hide the day-capture action and duplicate week strip. Use a short month label on the narrowest English screens to prevent arrow overlap. Choosing a date updates the original week and agenda and closes the picker; Escape returns focus to the month label. Reuse the existing search input and All/Tasks/Reminders controls in a visible phone search/filter group and move the same nodes back into the desktop disclosure on wide layouts. Keep task/reminder capture, drafts, account isolation and Back-to-close intact. Use grouped cards for the agenda and personal project rows. Preserve the original ghost header position, frosted sliding dock, thumb capture actions and all safe areas.

## Colors and depth

Map the existing light and dark tokens through the same CSS roles. Keep solid panel and surface colors as the fallbacks. On desktop, the workspace paint layer uses panel at 72% opacity in light mode and panel-dark at 60% in dark mode, with 28px backdrop blur and 1.05 saturation. The light phone shell uses 82% panel opacity and 20px blur for readability. The dark phone shell uses neutral-dark at 36% opacity with the same blur, allowing the navy-to-near-black background to remain visible; its editors stay opaque panel-dark. Its paint layer stays fixed to the viewport so a long list does not create a full-document blur surface. Put blur on a separate noninteractive pseudo-element, never on a container of fixed dialogs or navigation; do not isolate the workspace into a stacking context that traps its drawer beneath the shared backdrop. Light mode uses a fixed 165-degree tonal gradient from neutral at 0% to panel at 100%, keeping colored imagery out of the reading surface. Use text for navy reading content, primary for main actions and accent links, surface for quiet secondary controls and accent-soft for selection backgrounds. The light metadata role mixes text-muted 88% with text 12% to maintain readable contrast on tinted controls and the frosted dock. Primary buttons use on-primary text and primary-hover on hover. Dark mode replaces the image with a fixed 165-degree gradient from horizon-dark at 0%, through neutral-dark at 58%, to depth-dark at 100%. Use neutral-dark for the solid fallback, surface-dark for quiet controls and panel-dark for opaque editors. Dark primary actions use primary-dark with neutral-dark text, and primary-hover-dark on hover. Keep main reading text text-dark, metadata a muted-dark/text-dark mix, and reserve blue for primary actions and the existing accent roles. Dark danger and success use danger-dark and success-dark. Keep one background paint layer with no animated gradients or additional per-row blur. Thin window borders derive from text at 12% in light mode and 13% in dark mode. Compact secondary controls use surface at 48% opacity. Dark metadata mixes muted-dark 76% with text-dark 24% to stay readable on the material. Content rows remain open, without individual backdrop blur or shadows. Editors stay opaque panel or panel-dark; modal backdrops remain overlay-ink and unblurred.

The phone dock retains its Luma-inspired frosted surface: 72% surface opacity, 28px backdrop blur with 1.15 saturation, a subtle monochrome 6% top tint, a 14% text-derived border, and one quiet shadow. Its active capsule uses neutral at 56% opacity; inactive dark labels mix the metadata role 70% with text-dark 30%. Success and danger remain semantic, accompanied by checked state, strikethrough, or explicit labels.

## Typography

Use Gotham for Latin text on both phone and desktop when available under a suitable license. This repository includes local-only Gotham Book/Medium/Bold faces and the self-hosted Montserrat upright Latin variable font as a clearly named geometric fallback; it does not distribute Gotham. Preload the single 38 KB WOFF2 before blocking page scripts, keep font-display swap, and precache it for offline use. Genuine Gotham on all devices requires licensed webfont files. Chinese and other missing glyphs fall back to the native system stack. Display is 32px/600, section and sheet title 24px/600, task title 16px/500, body and input 16px/400, metadata 14px/400, actions 15px/600. Zero extra tracking. Use sentence case, readable CJK fallbacks, and tabular time and amount numerals. Phone inputs remain at least 16px to avoid focus zoom. The Tally amount field uses the 32px display role and tabular numerals, while category, date and secondary fields keep the body role. For CJK on Apple devices, retain PingFang through the native fallback stack; Android follows its installed Noto fonts. Keep task titles at medium weight, metadata at regular weight, and reserve semibold for headings and actions. Do not download platform fonts.

## Layout and shapes

Desktop rail and workspace share one centered `min(1120px, 92vw)` material window (the desktop workbench may widen to 1360px for its widget grid) with spacing.lg gaps and outer vertical spacing.lg. The rail joins its leading edge, and the workspace scrolls inside the window. Fixed dialogs retain viewport coordinates and page-wide overlays. Reading and editing controls remain reachable on short windows. Long-form reading columns cap at 48rem; Calendar, Planner, and Teamwork use the remaining width. The desktop workbench overview and its task action rows may fill the wider workspace. Phone uses spacing.md horizontal padding, spacing.lg between sections, open rows with a 72px minimum and spacing.sm vertical padding. Long titles wrap and grow naturally. Metadata starts underneath the title. Empty space is intentional.

Use rounded.sm for input controls and contained board cards, rounded.md for module panels, rounded.lg for sheets, and rounded.pill for compact actions and navigation. Task and reminder lists use open rows, with only a subtle separator where it helps. Avoid nested rounded boxes. Selectors use quiet text, a neutral capsule, or the blue primary role for an explicit selected control; no yellow filled navigation.

## Navigation and interactions

Task controls use one primary Today/Inbox/Top 3 view bar with a single Filter entry. Source, status, date range, category, priority and saved views live inside that filter surface; show active conditions as individually removable chips. A status of All does not silently clear an explicit date. Today explicitly returns to today. Preserve exact record deep links and the underlying original task list. Phone keeps one primary New task action above the dock; Templates belongs to Tools or the creation workflow.

Tools and Filters share an adaptive surface: desktop uses an anchored nonmodal popover that follows the trigger and avoids viewport edges; phone uses a short modal bottom sheet without moving the task list. Account switches dismiss these surfaces. Opening an editor from a temporary menu preserves one meaningful Back action and a reachable return focus target. Phone editors share a visual handle; only the handle or an explicitly safe noninteractive region can begin a downward close gesture. Content scrolling, text selection, keyboard use, task horizontal swipes and dock navigation retain their own gestures. Cancelled drags return to rest; a completed drag follows the same close/draft/history path as the explicit close control. Explicit close controls remain available.

Workspace search is a single grouped command interface for pages, existing records and clearly labelled actions. Recent items store only bounded identifiers scoped to the current owner and validate targets before display. Command actions open existing entry or focus sheets; they never silently create data. Preserve IME composition, keyboard navigation and the existing exact record links.

Each editor has one primary commit action, quiet secondary actions and inline feedback near the action. Errors retain input and expose a useful retry path; success uses the existing success role, while informational device/cloud status remains quiet. Reuse the single shared UndoBar and existing sync status rather than adding parallel floating notifications.

New sign-in choices are Google and local Guest only. Show the same choices on the welcome page, account dialog and guest reminder. Guest continues without OAuth or cloud writes and keeps local data. Do not expose Outlook or WeChat sign-in buttons. Existing account data and linked mailboxes remain available; Mail offers new Google connections only.

Desktop keeps the rail stuck to the viewport with theme and language at its foot. Phone keeps one centered fixed dock (Workbench / Calendar / Tally / More), sized to its contents even on landscape and wide windows, with theme and language inside More. Active dock items use clear text on one moving neutral capsule. Horizontal dragging anywhere inside the dock, including its blank padding, previews a destination with the capsule following the finger; release activates the nearest control once. Native touch input works independently of pointer capture, and duplicate touch/pointer/click events must never activate twice. Vertical motion, pointer cancellation, focus loss, or releasing well outside the dock restores the current selection. Dragging to More opens the drawer, and closing it returns the capsule to the current page. Plain clicks and keyboard activation remain native; modified link clicks open normally. Keep the dock touch-action as pan-y/pinch-zoom so vertical scrolling remains available. A valid cross-page navigation carries only its temporary capsule position to the destination for a 220ms slide, with a restrained 160ms/8px page entrance. Respect reduced motion by switching instantly while keeping the gesture. Keep all interactive targets at least 44px and preserve safe-area padding, including every page link and More disclosure inside the phone drawer. One action cluster per page region; no overlapping corner controls.

Today phone keeps title, date and a compact remaining summary, a single Today / Inbox / Top 3 view bar, separate completion controls and task detail actions. To do / Completed status remains available inside Filter rather than occupying another persistent tab row. A compact bottom New task action stays above the dock within thumb reach. Use the original welcome-sticker.png ghost mark for the assistant. The bottom editor retains title, date shortcuts, folded category/time/repeat, saved drafts, consecutive entry, IME handling, keyboard-safe Save, and Back-to-close. Hide dock and capture while editing. Delete remains in details with Undo.

Desktop Today keeps a visible composer and Ask agent trigger. Show task rows once in the main list beneath the compact desktop overview; summary cards read the same existing tasks and may link into their details. Keep date capture beside the input when space permits, one Filter entry for source/status/date range, and one Tools entry for occasional actions alongside Select above the list. Group the Today header and its stable save-feedback slot without adding a gap between them; use spacing.md between the main page regions on phone and desktop so tasks appear earlier. Place linked reminders and trips after the primary list. Keep repeat editing and Delete inside task details with Undo; rows show a quiet label only for an active repeat rule. Calendar desktop keeps the week grid and inline forms. Calendar task titles open the shared task details sheet in place with notes/checklist, date/time/category/repeat editing, drafts and Back-to-close. Completion belongs only to a separate 44px checkbox target, with keyboard-accessible title activation. Preserve source links and completion when saving details. Phone shows its stable Calendar title, compact week strip and selected day agenda; local filters live in a disclosure and one Add to this day action sits above the dock. The task/reminder editor reuses the existing forms inside a keyboard-safe sheet with a fixed Save footer, draft restoration and Back-to-close. Show a reminder once when its linked Todo also exists; keep orphaned linked tasks visible. Tally phone leads with today’s total and recent records. Quick entry and weekly insights use disclosures; CSV export and budget settings live in More. One Add expense action sits above the dock, and its editor preserves drafts, closes on Back and keeps Save visible above the keyboard. Use one Add expense / Edit expense heading, a prominent amount field, up to three quiet recent-category suggestions and the same Save label for creating and editing. Selected month and personal/shared view stay in session preferences scoped to the current identity. Planner phone shows one status at a time and uses explicit move controls; desktop retains the four-column board. Its header More menu exposes board-local search, Clear completed and board management on phone; desktop keeps local search in the toolbar. Moving between layouts preserves the search value and clearing availability. Shared Teamwork and personal private notes retain distinct labels and a quiet dashed separator. Private notes remain local for Guest and sync only with the personal account when signed in; never describe them as device-only or imply workspace members can read them. Mail uses an aligned vertical reading column with a compact title, account picker, refresh and notification icons, and More menu for PDF import and mailbox management. Inbox rows remain open: sender and time, a two-line subject and one-line preview, without inline action buttons. Today’s digest starts collapsed and shows up to three points, with the full summary available inside. Unavailable summaries use quiet text. Tapping a message opens a keyboard-accessible reader sheet with summary, preview, Gmail original link, contextual booking import and one primary Add to Today action. Select mode reveals checkboxes and a batch bar above the phone dock; leave enough scroll space for the last row. Refresh preserves the inbox, digest and selection while pending or failed. In-memory caches are scoped to each mailbox and cleared when the user changes or signs out. Guest Mail has one Gmail prompt and Google sign-in action. Center its envelope mark, title, short explanation and action horizontally, placing the group slightly above the midpoint between the header and phone dock. Use plain page space rather than a contained card; keep the header in place and let short screens scroll. Apply this layout only while no readable mailbox is connected, including the signed-in mailbox authorization prompt. Travel keeps a stable title and trip/day metadata. On phone, Travel day / Itinerary / Map switches expose the reading view, full itinerary or map and place search. A fresh phone visit defaults to Travel day and selects today when it falls within the trip; explicit saved views/dates take precedence. Desktop defaults to the full itinerary/map layout. Exact trip search and invitation links keep their existing targets visible without overwriting the saved view. Desktop keeps the contained map and stop panel below the shared header; storage/sharing explanations use a disclosure. Initialize the phone map only when Map is first opened, and initialize it on entry to the desktop layout. Reuse its instance and preserve its view when returning; keep the current trip and day in sync. Do not remove controls merely to simplify the first screen.

Every app page uses a stable page title, quiet context and one header action cluster for workspace search, notifications and page-specific More actions. The Agent entry always occupies the top trailing corner of this cluster on both phone and desktop, including Travel. Use the same 44px round monochrome button and original welcome-sticker.png ghost mark everywhere, with the mark sized to spacing.lg; reserve its space while other actions wrap on narrow screens. Keep one entry per page and do not mount it in the navigation dock or desktop rail. Its expanded state reflects the shared dialog, and closing restores the actual opening control. Agent uses one history entry: Back closes it before leaving the page, Forward reopens it with unsent text, and late replies do not take focus from the page. Agent requests and status checks belong to the opening identity and a request generation: cancel them, clear transcript/input and discard late success/error on an identity change, including a switch back to the original identity. Keep one submission busy through status discovery. Offline fallback only accepts explicit task commands and always applies the same destructive-action confirmation as online execution; preserve unanswered questions for retry instead of turning them into tasks. Distinguish unconfigured, configured-but-unverified, failed and successfully-responded status; configuration presence alone must never imply model connectivity. Reuse Mail’s notification placement throughout. Keep 32px page headings and 44px action targets; do not let page-specific typography override these roles. Guest save prompts stay compact below the header. Avoid startup focus changes that scroll users away from the title. Restore account-scoped reading positions in the actual scroll container: the document on phone, the workspace content pane on desktop. Wait for asynchronously loaded content, and let user interaction or explicit search targets take precedence over restoration.

Workspace search links carry the specific task, reminder, expense, card/board or trip ID. Select its date, month, board and column before opening or highlighting it. Search results show linked reminders and project cards once through their source record; if the source no longer exists, retain the linked task. Missing targets show a quiet status while keeping search available. Keep user content as text and preserve URL encoding for IDs. Undo clears every visible bottom action bar as well as the dock.

Task details disclose notes and a checklist without filling the main list with extra controls. Show only note presence and completed/total checklist progress in the row. Phone extends its existing draft-preserving editor; desktop opens one focus-trapped details panel. Source links use quiet text. Alert postponement uses explicit 10-minute/tomorrow labels and leaves the task deadline intact.

Todo multi-selection starts with Select above the list, shows separate selection checkboxes and the visible-list select-all state, and hides completion/edit/delete controls until selection ends. Its single contained batch bar sits above the phone dock; hide New task and leave room to scroll the final row. Complete and Tomorrow remain directly available, with date/category choices disclosed. Changes have Undo, positioned above the batch bar. Guest reminder status explicitly describes the page-open requirement; background push is an opt-in Google device setting and must show unconfigured/error states.

Task templates and import/backup open in one keyboard-safe sheet with a fixed action footer, Back-to-close and account-scoped template drafts. Today keeps Select above the list and places a quiet Templates action inside Tools on both layouts. Import & backup stays in the account dialog and Tally More. Template choices have a visible check as well as their pressed state; New template is a secondary list action and the footer emphasizes only Add these tasks. The batch disclosure can save selected tasks as a template. Preview counts before merging; display validation errors as text and keep existing records by ID.

Expense capture leads with amount, optional category and the prefilled date. A positive valid amount alone can be saved as Other (其他 in Chinese); typed categories never require selecting a suggestion. Quick entry follows the same optional-category rule. Keep the base currency and saved foreign currencies selectable even when they are absent from the preset list. Disable inactive exchange-rate inputs so a collapsed optional control cannot block a base-currency save. Show pending exchange-rate lookup in the Save action; retain required valid conversion rates for foreign expenses. If saving fails validation, show a concise alert beside Save, expand More options when necessary, and focus the missing/invalid field. Explain missing shared participants instead of silently ignoring the submit. Notes, trip, expense type, currency, exchange rate and participants live in More options. Restore that disclosure when a draft or existing record contains notes, a linked trip, shared participants or foreign currency. Keep validation errors reachable and all existing editing controls available. Exchange-rate responses apply only to the current identity, editor, currency and date. Cancel outdated requests and protect manual rates. Clear the prior rate when its context changes; wait for a valid automatic or manual rate before saving a foreign expense. Opening and closing the task, calendar, expense and workspace tool sheets share small translations and fades (180ms in, 160ms out); keep focus isolation until the exit completes and switch instantly for reduced motion. Modal backdrops use overlay-ink at 42% in light mode and 64% in dark mode, without backdrop blur. Never brighten a dark page behind its sheet. Disclosure rows show a directional chevron alongside their text.

Tally offers List / Month as a quiet segmented control within Transactions. List keeps today’s total and monthly records; Month replaces that total strip with a seven-column local-date calendar, one daily total per cell, and monthly total/daily average below it. Use saved exchange rates and the selected personal/shared ledger and trip filter for every total. Daily average divides by the full calendar month, including zero-spend days, and labels that denominator. A subtle primary tint marks spending days, an outline marks today and the primary role marks the selected date, with pressed/current semantics and complete dates/amounts in accessible labels. Keep dates at least 44px wide even on a 320px phone; expand only the calendar to the quiet page edges when necessary. Large amounts use compact notation in cells and full values in the selected-day summary and records. Selecting a day shows its records or a day-specific empty state below the calendar; use the existing expense sheet to add to that date and preserve meaningful drafts and existing record dates. Keep calendar buttons in place through data refreshes, support arrow-key day navigation and visible focus, and persist layout/date/month/ledger per identity. Ordinary navigation restores these preferences; exact expense links select the correct record date. Keep the current dock, thumb-reachable Add expense and keyboard-safe editor.

Protect ledger history: once expenses, settlements or trip budgets exist, keep the base currency read-only and explain that individual expenses can still use other currencies. Never reinterpret saved rates or silently truncate records or settlements. Large-ledger backup and restore remain compatible within explicit file-size limits. New expenses and quick capture inherit the active trip filter unless an existing record or meaningful draft already supplies its own trip choice. New-expense Save and add another is a quiet secondary action beside the primary Save in the existing keyboard-safe footer; retain date, category, currency/rate, trip, scope and participants while clearing amount and note. Keep Enter as ordinary Save, one sheet/history entry, a concise saved status and 44px targets at 320px. Failed device saves retain the form and show a storage error.

Travel expenses use one disclosure in the itinerary, with a total, selected-day spend, optional budget and open category rows and a disclosed ledger record list. Link to the user's own ledger with an explicit privacy label; sharing a trip does not share financial data. Expense capture has an optional Trip selector. Missing trips retain an editable saved link, and expense deep links open the correct month and editor. Use saved exchange rates and the ledger's base currency for all totals. Refresh amounts and records without rebuilding the whole expense disclosure for the same trip and identity; preserve expanded records, focused inputs, unfinished budget edits and scroll position.

Personal Travel trips create one linked task each on the departure date, including existing trips. Show a quiet `Travel` capsule using the metadata typography and surface roles in Todo and Calendar, without replacing the user's category. Task details link back to the specific trip. Preserve completion and personal task details when refreshing; propagate later trip name/date changes without duplicating tasks. Deleting a linked task keeps the trip and suppresses automatic recreation; deleting the trip removes its linked task. Trips in the future follow the existing task date filters.

## Motion and accessibility

Today offers Selected day / Next 7 days as one quiet range control. Both layouts place range and selected-date inputs inside the shared Filter surface; the header date may open the same surface; show the active date or next-seven-days scope in its summary, close after applying a choice, and let Escape/outside activation dismiss it. Keep Select and Tools on one compact control row, with To do / Completed inside Filter, with enough room for selection controls and 44px targets on narrow screens. The week range includes today through six days ahead, keeps date/time labels, and sorts chronologically; explicit date or search navigation restores the selected-day scope. Switching from Next 7 days back to Selected day restores the previously chosen date instead of resetting it to today. Persist range, selected day, status/source filters and reading position in session preferences scoped to the current identity on both phone and desktop. Restore after ordinary dock navigation and reload, while explicit task/date/search targets and user scroll take precedence. Fresh phone capture follows the selected day; the next-seven-days view defaults to today. Existing tasks and meaningful drafts keep their own explicit dates, including an undated task. Closing an empty new-task form must not create a stale date-only draft. Natural-language capture is local and optional: suggest recognized Chinese/English dates and times beside the input, apply only after explicit activation, keep the extracted date/time editable, and preserve IME composition. Never silently strip text at save time.

Phone task rows support optional horizontal swipes independently of the dock. A left swipe reveals explicit Tomorrow, Delete and Close buttons behind a translated task foreground, keeping the row height and neighboring task positions unchanged. Animate reveal/close with a small translation and honor reduced motion. A right swipe completes an open task with Undo and reuses the checkbox completion departure; immediate Undo cancels departure and restores the row. Vertical movement, multi-touch, cancellation, focus loss and an outside release cancel the action. Preserve checkboxes, details, batch selection, keyboard paths and reduced motion. Keep task quick actions monochrome and at least 44px.

Use a quiet status row below the page header for device saves, pending/offline changes, active sync and cloud failures. Reserve a stable 44px slot even before the first save, using a hidden, inert label rather than inserting new layout space on mutation. Keep Retry/Review within the same slot, allow long status text to scroll inside it, and retain readable feedback at 320px. Offer Retry after a failed sync, and open the existing account conflict choices rather than overwriting either version. Do not claim cloud success while local changes remain pending. Keep Guest sign-in prompts compact, with their existing Google and Later actions.

Account sync checks the cloud every 30 seconds while visible and when the window regains focus or a connection returns. Compare local and remote snapshots against the last acknowledged baseline; upload local-only changes, apply remote-only changes in place, and preserve both divergent versions until the user chooses in the Account dialog. Delay applying remote updates while a sheet or input is active. Include local edits made during reads and retain edits made during writes for the next save. Bound requests to 20 seconds, retry transient failures after 5/10/20/40/60 seconds, and offer immediate Retry. Distinguish sign-in expiry, timeout, service failure and capacity errors within the existing stable status slot. Expired sessions keep local data and expose Reconnect Google without signing out automatically. Account changes cancel pending requests and prevent late replies from updating the new identity. Keep conflict choices and export reachable in the existing account dialog, with 44px actions; avoid new floating controls.

Sync caches are owned by the account whose workspace is actually loaded, including failed/offline transitions. Preserve a durable Guest copy before Google sign-in and use the existing version-choice dialog for divergent Guest and cloud contents. Snapshot application must detect write failures, retain recovery data, stop acknowledgments/uploads and offer explicit retry instead of reporting success. While an earlier signed-in workspace or a partial recovery is unresolved, hide its content and capture controls behind one in-flow protection panel with Retry, Account and owned-data export. Keep modal focus isolation intact. Cross-tab auth and workspace-owner events reset page models before making the new account editable. Team Planner requests and mutations belong to the current account and selected board; ignore late replies and clear private board content immediately on account changes or signout while retaining personal boards. Bound Mail account, inbox and booking operations to 20 seconds, including response parsing, and expose Retry without discarding usable messages or selections. Cancellation and identity checks prevent late timed-out replies from changing a new mailbox, reader or dialog.

Travel exposes Edit trip and Add a place from the itinerary, including a keyboard-safe place search sheet that closes with Back. Stop controls allow renaming, notes, day changes and explicit up/down ordering; shared reordering is atomic and revision guarded. Reject date shortening that would drop later stops or bookings. The Travel day view keeps a date selector, next-stop navigation, personal visited/undo state, booking details and the selected day's private ledger total/budget. Within the same identity and trip, update the companion incrementally: retain the date selector, unchanged options/stops/bookings and focused controls, and update only expense text for ledger events. Preserve scroll, expanded disclosures, and unfinished editor input through background refreshes; clear reused content when the trip or identity changes. Keep the original trip selector reachable above the date and next stop. Put Edit trip, Add a place, New trip, Delete trip, sharing and storage inside a Trip options disclosure below the reading content, retaining the existing controls and handlers. Restore those controls to their itinerary positions when leaving Travel day. Keep all itinerary/map controls and remember explicit view/day choices per identity; activating the current Travel day tab must not reset a selected date, and account/layout changes must not persist an implicit default as a user choice. A quiet saved-trip message links to its scheduled task. Never initialize a hidden map for this view or describe personal ledger amounts and visited state as shared member data.

Use brief opacity or small translation transitions, without scaling content cards or glowing hover states. Keep keyboard focus clearly visible with the text token and an outline; never remove focus feedback. Honor reduced motion (workspace and dock blur reduce to 16px) and reduced transparency (hide the backdrop image and use opaque surfaces with no blur). Browsers without backdrop-filter receive a solid workspace, controls and dock. Apply the same phone material and dock to the explicit phone shell on wide preview windows; desktop rails join the material window with a quiet separator. Preserve modal focus traps, scroll locking, account-scoped drafts, and Undo. No new blocking confirmations for reversible deletions.

## Native iOS widget

The installed Capacitor app may expose a read-only WidgetKit Today widget in small and medium Home Screen families. Keep the original ghost, native system typography and monochrome progress. Small emphasizes remaining count and completed/total; medium adds up to three one-line task titles and quiet times. Native color assets map panel/panel-dark, text/text-dark and text-muted/muted-dark from this file. Font sizes use display 32/600, task 16/500 and metadata 14/400; gaps use spacing.xs/sm, the ghost uses spacing.lg, and pre-iOS-17 container padding uses spacing.md. Let the OS own the widget shape and modern background treatment.

Show an open-app prompt for missing/unverified data, retain the last app update time, and avoid promising instant or background cloud refresh. Account changes clear the shared preview until the new account is ready; only task title/time previews and day counts enter the App Group. Tapping opens Today in the app; no inline completion control is presented. Website/PWA users do not gain a native widget simply by adding a home-screen shortcut.

## Implementation

Use tokens from this file for colors, typography, spacing, and radii. Shared presentation lives in visual-refinement.css, loaded after page styles. Keep page behavior in the existing vanilla JS modules. Shared typography applies to both themes. Light mode uses cool white, navy text and a restrained blue accent; dark mode uses the navy-to-near-black palette. Keep the existing user theme preference. Browser and native status-bar colors follow the current page background token.

## User-directed layout continuity

Use short position-only transitions for explicit Top 3 up/down moves and deliberate widget/section reordering. Capture existing keyed rectangles and animate to the actual new layout without delaying the underlying save. Initial loading, filter changes and background sync stay quiet. Cancel or replace a prior layout animation on a new reorder, account change, resize, scroll or active swipe. Keep layout motion separate from row-completion and swipe transforms, and skip it under reduced motion. Use the existing 180ms small-transition rule and preserve explicit up/down controls alongside any drag affordance.
