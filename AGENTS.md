# Agent Design Guidelines

## Design system

This project uses `DESIGN.md` as the single source of truth for all visual decisions.

## Before writing any UI code

1. Read `./DESIGN.md`
2. Extract tokens from the YAML front matter
3. Map tokens to this codebase’s CSS variables in `styles.css` / page CSS (`planner.css`, `tally.css`, `teamwork.css`, etc.)

## After finishing any UI change

1. Check for overlapping controls (Menu, language toggle, theme/dock, page actions, map zoom, sheets).
2. Verify desktop and mobile safe zones — no two tappable controls should share a corner.
3. Prefer one action cluster per page region; do not stack floating pills on top of site chrome.

## Token usage rules

- Colors → always from `colors.*` in DESIGN.md, never hardcoded hex
- Typography → always from `typography.*`, never arbitrary font sizes for new UI
- Spacing / rounding → use `spacing.*` and `rounded.*`

## After writing UI code

1. Run `npx @google/design.md lint DESIGN.md` and keep `errors: 0`
2. If you changed DESIGN.md, compare with the previous version:
   `npx @google/design.md diff DESIGN.md DESIGN-prev.md`

## Export when needed

- Tailwind JSON: `npx @google/design.md export --format json-tailwind DESIGN.md`
- CSS theme vars: `npx @google/design.md export --format css-tailwind DESIGN.md`

## Stack notes

Daily Space is primarily vanilla HTML/CSS/JS (not React). Prefer existing class patterns and CSS variables over introducing a new component framework unless explicitly asked.
