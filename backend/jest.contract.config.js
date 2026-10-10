/** @type {import('jest').Config} */
// The LIVE CONTRACT runner (`npm run test:contract`): every API route and every
// frontend service call against a RUNNING backend, mocking nothing
// (src/tests/e2e/liveContract.smoke.test.js — its header says how to run it).
//
// Its own runner since 2026-10-10 (owner rule: no test may be skipped). It used
// to sit in the e2e run behind `LIVE_CONTRACT === "1" ? describe : describe.skip`,
// so the default run reported it skipped. Here it always runs, and fails when
// the stack it needs is not there. It needs what the e2e run does not: a
// NON-production stack seeded with /migration/seed-demo (refused in production,
// P10-16), and up to 30 minutes. On the disposable stack: SEED_DEMO=true in its
// env file, E2E_NODE_ENV=development, then GET /migration/seeding and
// /migration/seed-demo; LIVE_CONTRACT_BASE_URL (or BASE_URL) and
// E2E_OPERATOR_PASSWORD as for the e2e run (MEMORY/records/2026-10-10-no-skip-e2e-browser.md).
const e2e = require("./jest.e2e.config");

module.exports = {
  ...e2e,
  testMatch: ["**/tests/e2e/liveContract.smoke.test.js"],
  testPathIgnorePatterns: ["/node_modules/"],
  // It reads no mail: Mailpit is not required here.
  globalSetup: undefined,
  testTimeout: 30 * 60 * 1000,
};
