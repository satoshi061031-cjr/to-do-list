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

Today phone keeps title, date and remaining count, To do / Completed tabs, separate completion controls and task detail actions. A compact bottom New task action stays above the dock within thumb reach. Use a simple line icon for the assistant. The bottom editor retains title, date shortcuts, folded category/time/repeat, saved drafts, consecutive entry, IME handling, keyboard-safe Save, and Back-to-close. Hide dock and capture while editing. Delete remains in details with Undo.

Desktop Today keeps a visible composer and Ask agent trigger. Calendar desktop keeps the week grid and search; phone keeps the day strip and vertical reminders with an inline composer. Tally phone keeps today's total and quick entry; fuller charts remain on desktop. Planner phone shows one status at a time and uses explicit move controls; desktop retains the four-column board. Shared Teamwork and device-only notes retain distinct labels and a quiet dashed separator. Mail remains an aligned vertical reading column. Travel retains its functional map and stop panel. Do not remove controls merely to simplify the first screen.

## Motion and accessibility

Use brief opacity or small translation transitions, without scaling content cards or glowing hover states. Keep keyboard focus clearly visible with the text token and an outline; never remove focus feedback. Honor reduced motion (dock blur reduces to 16px) and reduced transparency (solid surface with no blur). Browsers without backdrop-filter receive a solid dock. Apply the same dock to the explicit phone shell on wide preview windows; desktop rails retain solid surfaces. Preserve modal focus traps, scroll locking, account-scoped drafts, and Undo. No new blocking confirmations for reversible deletions.

## Implementation

Use tokens from this file for colors, typography, spacing, and radii. Shared presentation lives in visual-refinement.css, loaded after page styles. Keep page behavior in the existing vanilla JS modules. Changes apply equally to light and dark modes and do not force a theme on existing users.
