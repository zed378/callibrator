/** @type {import('jest').Config} */
// The live suites' jest configuration (2026-10-10, no-skip): `*.live.test.*` only.
//
// The unit configuration (jest.config.js) ignores every live suite, so `npm test` and
// `npm run test:coverage` never load one and report none of them as skipped. The live suites
// run here instead — through `npm run test:live` (scripts/live-suites.ts: a fresh database per
// suite, and the brokers each needs), or one file by hand with `npm run test:live:jest -- <file>`.
// A live suite has no opt-in gate any more: under this configuration it RUNS, and it FAILS when
// its database or broker is missing.
//
// Everything else — the transform, the Node-major check, the secret scan, module resolution —
// is the unit configuration's, so a live suite runs exactly as it did when the unit
// configuration picked it up. No coverage: the unit gate measures coverage.
const unit = require("./jest.config.js");

module.exports = {
  ...unit,
  testMatch: ["**/src/tests/**/*.live.test.js", "**/src/tests/**/*.live.test.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
  collectCoverage: false,
  coverageThreshold: undefined,
};
