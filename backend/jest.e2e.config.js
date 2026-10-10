/** @type {import('jest').Config} */
require("dotenv").config({ path: ".env" });

// P9-03 / ADR-087 — the same TypeScript transform as jest.config.js (see the
// comment there), so the e2e suite keeps running when its first spec converts.
const TYPESCRIPT_TRANSFORM = "<rootDir>/jest.transform.js";

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/e2e/**/*.test.js", "**/tests/e2e/**/*.test.ts"],
  // The live contract smoke has its own runner (jest.contract.config.js,
  // `npm run test:contract`): it needs a demo-seeded NON-production stack and
  // up to 30 minutes, so it is not part of this run — and never skipped in its own.
  testPathIgnorePatterns: ["/node_modules/", "/tests/e2e/liveContract\\.smoke\\.test\\.js$"],
  // 2026-10-10 (no test may be skipped): mail is mandatory — a run without a
  // reachable Mailpit (E2E_MAILPIT_URL) refuses to start instead of skipping
  // the mailed-secret tests.
  globalSetup: "<rootDir>/src/tests/e2e/requireMailpit.ts",
  verbose: true,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: false,
  transform: { "^.+\\.ts$": TYPESCRIPT_TRANSFORM },
  transformIgnorePatterns: ["/node_modules/"],
  // "js" before "ts": a module is never both (scripts/build-dist.ts refuses
  // the build if one is), and the order keeps every existing resolution as it was.
  moduleFileExtensions: ["js", "ts", "json"],
  testTimeout: 30000,
};
