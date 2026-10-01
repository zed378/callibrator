// @callibrator/contracts tests and coverage (P9-22, ADR-097).
//
// The schemas' behaviour is pinned where it always was: by the backend's
// validator suites (fields.p911, vendor / calibrationDevices validator tests),
// which import them through backend/src/validators/*. The backend's own jest
// cannot MEASURE this package — jest instruments only files under its
// rootDir, and backend/'s rootDir does not contain packages/ (probed: the
// package reads 0% there while its tests pass). So this config runs those
// same suites with the repository root as rootDir, holds the package to the
// backend's 100% gate, and adds the package's own test/ (the barrel, and one
// zod for every consumer).
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");

/** @type {import('jest').Config} */
module.exports = {
  rootDir: REPO,
  roots: ["<rootDir>/packages/contracts", "<rootDir>/backend/src/tests/validators"],
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/packages/contracts/test/**/*.test.ts",
    // Every backend validator suite: they exercise the schemas this package
    // now holds (each backend validator re-exports them). Coverage is still
    // collected from packages/contracts/src only.
    "<rootDir>/backend/src/tests/validators/**/*.test.{js,ts}",
  ],
  // networkSecurity stays backend-only (it uses Node's `net`, ADR-097 Am. 2), and
  // its a288 suite loads the backend's configuration.
  testPathIgnorePatterns: ["/node_modules/", "/networkSecurity\."],
  moduleFileExtensions: ["js", "ts", "json"],
  // The backend's TypeScript transform (Babel 8, ADR-087 Amendment 1): the
  // backend suites above need it, and the package source is erased the same way.
  // Babel resolves its plugins from the working directory, and the Babel 8
  // ones live in backend/node_modules, so `npm test` here runs from backend/.
  transform: { "^.+\.ts$": "<rootDir>/backend/jest.transform.js" },
  collectCoverage: true,
  collectCoverageFrom: ["packages/contracts/src/**/*.ts"],
  coverageDirectory: "<rootDir>/packages/contracts/coverage",
  coverageThreshold: {
    global: { branches: 100, functions: 100, lines: 100, statements: 100 },
  },
};
