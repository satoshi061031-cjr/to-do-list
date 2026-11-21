// ESLint flat config. Run with `npm run lint`.
//
// Errors are reserved for rules that catch real bugs (undefined names,
// duplicate keys, unreachable code, bad typeof comparisons...). Rules that
// mostly flag intentional or stylistic code are warnings, so they stay
// visible without failing CI.
const js = require("@eslint/js");
const globals = require("globals");

// Root-level files that run in Node rather than in the browser.
const nodeRootFiles = ["eslint.config.js", "capacitor.config.js"];

module.exports = [
  {
    ignores: [
      "node_modules/",
      "vendor/",
      "ios/",
      "android/",
      "www/",
      "docs/",
      "server/data/",
      ".claude/",
    ],
  },

  js.configs.recommended,

  {
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Redundant initial values (`let x = null` before every branch assigns it).
      "no-useless-assignment": "warn",
      // Intentional patterns here: input sanitising and YAML indentation.
      "no-control-regex": "warn",
      "no-regex-spaces": "warn",
    },
  },

  // Browser client: classic scripts that share state through `window.*`.
  // Shared modules also load in Node (tests, server/quick-add.js) behind
  // `typeof module` / `typeof require` guards.
  {
    files: ["*.js"],
    ignores: [...nodeRootFiles, "sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "readonly",
        require: "readonly",
      },
    },
  },
  {
    // Node fallback when TextEncoder is unavailable.
    files: ["record-history-core.js"],
    languageOptions: { globals: { Buffer: "readonly" } },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },

  // Node: every script outside the repository root (server/, scripts/, tests/
  // and any new tool directory), any .cjs/.mjs file, and the root config files.
  {
    files: ["**/*.js", "**/*.cjs"],
    ignores: ["*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: nodeRootFiles,
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.nodeBuiltin },
    },
  },

  // Tests run in Node, but Playwright `page.evaluate` callbacks run in the page.
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        DailySpaceTodo: "readonly",
      },
    },
  },
];
