/**
 * Root Prettier config. It does NOT govern backend/ (P9-02, ADR-092):
 * Prettier uses the nearest config file and never merges two, so every file
 * under backend/ is formatted by backend/.prettierrc (double quotes, width 80,
 * trailing commas "all") — the same choices backend/eslint.config.js enforces.
 * Check with `npx prettier --find-config-path backend/index.js`.
 *
 * What this file does govern is left to the frontend owner: frontend/src is
 * almost entirely double-quoted, which this file's `singleQuote` contradicts
 * (open item recorded in ADR-092).
 *
 * @type {import('prettier').Config}
 */
module.exports = {
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  arrowParens: 'always',
};
