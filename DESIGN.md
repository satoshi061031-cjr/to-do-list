---
version: alpha
name: Daily Space
description: Quiet glass productivity space — frosted panels, soft mist backgrounds, condensed display type, and a single warm yellow call-to-action.
colors:
  primary: "#35322e"
  on-primary: "#faf8f4"
  secondary: "#4f6368"
  tertiary: "#f6d84f"
  on-tertiary: "#2c2925"
  neutral: "#e7e9ea"
  surface: "#f2f4f1"
  text: "#2c2925"
  text-muted: "#6f6a62"
  accent: "#4f6368"
  accent-soft: "#e8ecec"
  danger: "#a64b45"
  success: "#5a6b58"
  glass-border: "#ffffff14"
  highlight: "#f6d84f"
typography:
  display:
    fontFamily: Impact, Haettenschweiler, "Franklin Gothic Bold", "Arial Narrow Bold", sans-serif
    fontSize: 3rem
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: 0.01em
  title:
    fontFamily: Impact, Haettenschweiler, "Franklin Gothic Bold", "Arial Narrow Bold", sans-serif
    fontSize: 1.75rem
    fontWeight: 400
    letterSpacing: 0.02em
  body-md:
    fontFamily: Impact, Haettenschweiler, "Franklin Gothic Bold", "Arial Narrow Bold", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Impact, Haettenschweiler, "Franklin Gothic Bold", "Arial Narrow Bold", sans-serif
    fontSize: 0.72rem
    fontWeight: 800
    letterSpacing: 0.12em
rounded:
  sm: 18px
  md: 24px
  lg: 36px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.pill}"
    padding: 12px
    typography: "{typography.body-md}"
  button-primary-hover:
    backgroundColor: "{colors.highlight}"
    textColor: "{colors.on-tertiary}"
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
    textColor: "{colors.highlight}"
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
---

## Overview

Daily Space is a calm personal productivity product. The visual language is **frosted glass over misty photographic backgrounds**: translucent panels, soft depth, and condensed display typography. Interaction is driven by a single warm yellow accent (`tertiary` / `highlight`), not purple gradients or terracotta brochure looks.

Prefer atmosphere over dashboard density. First viewports should feel like one composed space — brand/greeting, one primary action area, and quiet supporting modules — not a control panel of cards and stats.

## Colors

The light theme is the default token set. Dark theme mirrors the same roles with inverted values in CSS (`:root[data-theme="dark"]`); when editing UI, keep the same token names and map through CSS variables.

- **primary (#35322e):** Dense ink for strong text and primary chrome.
- **secondary / accent (#4f6368):** Cool slate for secondary actions, links, and muted structure.
- **tertiary / highlight (#f6d84f):** Sole energetic accent for primary buttons, kickers, and focus rings.
- **neutral (#e7e9ea):** Page wash behind the photographic blur.
- **surface (#f2f4f1):** Solid stand-in for glass panels; in CSS prefer `var(--glass)` / `var(--glass-strong)` radial fills.
- **text / text-muted:** Body and caption hierarchy.
- **danger / success:** Sparse semantic colors — never replace the yellow CTA.

Never invent new brand hues. Never hardcode hex in new UI — use `var(--…)` that map to these tokens.

## Typography

Display and UI currently share a condensed Impact-led stack for a bold, stamped voice. Titles can be large and tight (`display` / `title`). Body copy stays readable with generous line-height (`body-md`). Kickers and field labels use `label-caps` with wide tracking and the yellow highlight color.

Do not switch to Inter, Roboto, Arial, or system-ui as the brand voice.

## Layout

- Max content width around `min(1120px, 92vw)`.
- Module gaps use `spacing.md`–`spacing.lg`.
- Desktop: multi-column grids with breathing room; mobile: single column, extra top padding for the menu trigger.
- One job per section: one heading, one short supporting line, one primary interaction cluster.

## Elevation & Depth

Depth comes from frosted glass, inset highlights, and soft drop shadows — not neon glow stacks.

- Panels: `backdrop-filter` blur + translucent fills (`--glass`, `--glass-strong`).
- Shadows: `--shadow`, `--shadow-soft`, `--shadow-pop`, `--glow` (warm, subtle).
- Hover lift: slight `translateY` + scale; respect `prefers-reduced-motion`.
- Focused inputs may “bubble pop” (lift, larger radius, yellow-tinted ring) as on Teamwork.

## Shapes

Use large radii: `rounded.sm` (18px), `rounded.md` (24px), `rounded.lg` (36px). Pills (`rounded.pill`) for primary buttons and compact toggles. Avoid sharp broadsheet zero-radius layouts and tiny 4px chips.

## Components

- **button-primary:** Yellow fill, dark text, pill shape — the only loud control.
- **button-secondary / glass controls:** Quiet translucent surfaces with soft borders.
- **card-glass:** Module shells (todo, tally, teamwork). Prefer glass tokens over opaque white cards.
- **input-bubble:** Transparent until focus, then elevated bubble treatment.
- **kicker:** Small uppercase yellow labels above titles.

Variants that need hover/active states should keep the same token family; do not introduce purple, glow-heavy, or multi-shadow fashion defaults.

## Do's and Don'ts

**Do**

- Read this file before editing UI.
- Map colors/spacing/radius through existing CSS variables in `styles.css` (and page CSS files).
- Keep photographic mist backgrounds and glass panels as the atmospheric base.
- Preserve light/dark parity via the same token roles.

**Don't**

- Hardcode new hex colors in components.
- Default to purple-on-white, cream+terracotta, or dense newspaper layouts.
- Fill the first viewport with stats strips, promo chips, or card grids that fight the brand.
- Add emoji ornaments or glow-for-glow’s-sake effects.
