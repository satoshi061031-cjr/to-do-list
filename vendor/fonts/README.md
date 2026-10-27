# Web typography

The site prefers locally installed Gotham (Book 400, Medium 500, Bold 600–700).
No Gotham font files are distributed with this repository. To serve genuine
Gotham on every device, supply WOFF2 files under a license permitting web
embedding, then replace the local-only `Daily Space Gotham` faces in
`mobile-typography.css` and add the files to `server/public-assets.js` and `sw.js`.
Do not rename a substitute font to Gotham.

When Gotham is unavailable, Latin text uses Montserrat, an open-source geometric
alternative. Chinese and other missing glyphs retain the system fallback stack.
The bundled upright Latin variable font covers weights 100–900, uses
`font-display: swap`, is preloaded by each page, and works offline with no third-party font requests.

- Source: `@fontsource-variable/montserrat` 5.2.8,
  `files/montserrat-latin-wght-normal.woff2` (37,956 bytes).
- License and copyright: [SIL Open Font License 1.1](Montserrat-OFL.txt).
- Native WidgetKit typography remains the OS system font.
