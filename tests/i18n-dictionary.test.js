const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8");

/** Keys are written one per line at four-space indent, so a line scan is exact. */
const KEY_LINE = /^ {4}(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*))\s*:/;

/**
 * @param {string} startMarker
 * @param {string} endMarker
 * @returns {{ key: string; line: number }[]}
 */
function dictionaryEntries(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker);
  assert.ok(start !== -1, `${startMarker} not found in i18n.js`);
  assert.ok(end > start, `${endMarker} not found after ${startMarker}`);
  const lineOffset = SOURCE.slice(0, start).split("\n").length;
  return SOURCE.slice(start, end)
    .split("\n")
    .map((line, index) => {
      const match = line.match(KEY_LINE);
      if (!match) return null;
      return { key: match[1] !== undefined ? match[1] : match[2], line: lineOffset + index };
    })
    .filter(Boolean);
}

const zh = dictionaryEntries("const ZH", "const ATTR_ZH");
const attrZh = dictionaryEntries("const ATTR_ZH", "const PATTERNS_ZH");

/** Interpolated strings are translated by regex instead of an exact key. */
const patterns = (() => {
  const start = SOURCE.indexOf("[", SOURCE.indexOf("const PATTERNS_ZH"));
  const end = SOURCE.indexOf("\n  ];", start);
  assert.ok(start !== -1 && end > start, "PATTERNS_ZH array not found in i18n.js");
  const literal = SOURCE.slice(start, end + "\n  ]".length);
  /** @type {[RegExp, string][]} */
  const parsed = new Function(`return ${literal};`)();
  assert.ok(parsed.length > 20, `expected populated PATTERNS_ZH, saw ${parsed.length}`);
  return parsed.map(([pattern]) => pattern);
})();

/**
 * Strings that read the same in both languages: the product name, currency
 * symbols, numeric format hints, and an example email address.
 */
const UNTRANSLATED_BY_DESIGN = new Set([
  "Daily Space",
  "¥",
  "0.00",
  "teammate@email.com",
  "friend@gmail.com",
]);

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&rsquo;": "’", "&lsquo;": "‘", "&mdash;": "—", "&ndash;": "–", "&nbsp;": " " };

/** @param {string} value */
function decodeEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#39|rsquo|lsquo|mdash|ndash|nbsp);/g, (entity) => HTML_ENTITIES[entity]);
}

test("i18n dictionaries have no duplicate keys", () => {
  // A duplicate key is legal JS — the later value silently wins and the earlier
  // translation becomes dead code, so only a source scan can catch it.
  for (const [name, entries] of [
    ["ZH", zh],
    ["ATTR_ZH", attrZh],
  ]) {
    const seen = new Map();
    const duplicates = [];
    for (const entry of entries) {
      if (seen.has(entry.key)) {
        duplicates.push(`${name}["${entry.key}"] at line ${seen.get(entry.key)} and ${entry.line}`);
      } else {
        seen.set(entry.key, entry.line);
      }
    }
    assert.deepEqual(duplicates, [], `Duplicate keys found:\n${duplicates.join("\n")}`);
  }
});

test("i18n key scanner still sees the dictionaries", () => {
  // Guards against the scan silently matching nothing if formatting changes.
  assert.ok(zh.length > 300, `expected a populated ZH dictionary, saw ${zh.length} keys`);
  assert.ok(attrZh.length > 50, `expected a populated ATTR_ZH dictionary, saw ${attrZh.length} keys`);
});

/**
 * `translateString` falls back to ZH for attributes, but text nodes are only ever
 * looked up in ZH — so an ATTR_ZH-only key still renders English as visible text.
 */
const TEXT_KEYS = new Set(zh.map((entry) => entry.key));
const ATTRIBUTE_KEYS = new Set([...zh, ...attrZh].map((entry) => entry.key));

/**
 * @param {Set<string>} known
 * @param {(html: string, page: string, report: (value: string) => void) => void} scan
 */
function findUntranslated(known, scan) {
  const missing = new Map();
  const pages = fs.readdirSync(ROOT).filter((name) => name.endsWith(".html"));
  assert.ok(pages.length > 0, "expected HTML pages at the repo root");
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    scan(html, page, (value) => {
      if (!value || known.has(value) || UNTRANSLATED_BY_DESIGN.has(value)) return;
      if (patterns.some((pattern) => pattern.test(value))) return;
      if (!missing.has(value)) missing.set(value, new Set());
      missing.get(value).add(page);
    });
  }
  return [...missing].map(([value, files]) => `"${value}" in ${[...files].join(", ")}`);
}

/** @param {string[]} report */
function assertNothingUntranslated(report) {
  assert.deepEqual(
    report,
    [],
    `These strings would stay English in the Chinese UI:\n${report.join("\n")}`
  );
}

test("every HTML placeholder and aria-label has a translation", () => {
  assertNothingUntranslated(
    findUntranslated(ATTRIBUTE_KEYS, (html, _page, report) => {
      for (const pattern of [/placeholder="([^"]+)"/g, /aria-label="([^"]+)"/g]) {
        for (const match of html.matchAll(pattern)) report(decodeEntities(match[1]).trim());
      }
    })
  );
});

test("every static HTML text label has a translation", () => {
  assertNothingUntranslated(
    findUntranslated(TEXT_KEYS, (html, _page, report) => {
      const markup = html
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<svg[\s\S]*?<\/svg>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
      for (const match of markup.matchAll(/>([^<>{}]+)</g)) {
        const text = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
        // Skip fragments with no letters (icons, separators) and anything that
        // is already Chinese.
        if (text.length < 2 || !/[A-Za-z]/.test(text) || /[\u4e00-\u9fff]/.test(text)) continue;
        report(text);
      }
    })
  );
});
