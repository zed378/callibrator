/** @type {import('jest').Config} */
require("dotenv").config({ path: ".env" });

module.exports = {
  testEnvironment: "node",
  testMatch: [
    "**/__tests__/**/*.js",
    "**/tests/**/*.test.js",
    "**/tests/**/*.spec.js",
  ],
  testPathIgnorePatterns: ["src/tests/e2e/", "/node_modules/"],
  verbose: true,
  forceExit: false,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: true,
  collectCoverageFrom: [
    "src/app.js",
    "src/config/**/*.js",
    "src/constants/**/*.js",
    "src/controllers/**/*.js",
    "src/middlewares/**/*.js",
    "src/routes/**/*.js",
    "src/services/**/*.js",
    "src/utils/**/*.js",
    "src/validators/**/*.js",
  ],
  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/",
    "/__tests__/",
    "src/config/",
    "src/constants/",
    "src/docs/",
    "src/models/",
    "src/scripts/",
  ],
  coverageThreshold: {
    "global": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/validators/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/utils/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/middlewares/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/controllers/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/services/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/routes/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  transform: {},
  transformIgnorePatterns: ["/node_modules/"],
  // A-99: otplib is NOT mapped to a mock any more. __mocks__/otplib.js invented
  // an `authenticator` export otplib 13 does not have, and accepted every
  // code, so MFA was broken in production behind a green suite. Note that a
  // file in <rootDir>/__mocks__/ named after a package mocks it for EVERY test
  // even without an entry here — deleting the entry alone changes nothing.
  //
  // otplib 13's CommonJS build requires ESM-only packages (@scure/base,
  // @noble/hashes). Jest loads them only with --experimental-vm-modules, which
  // the package.json test scripts pass; a bare `npx jest` on a suite that runs
  // the real otplib fails with "Must use import to load ES Module".
  //
  // A-116: uuid is NOT mocked globally any more. __mocks__/uuid.js and a
  // `^uuid$` mapping replaced the package for every require, Sequelize's
  // own included (it generates UUIDV1/UUIDV4 defaults through it), so every
  // UUIDV4 default in a unit run was one constant and UUIDV1 threw. uuid 14 is
  // ESM-only and loads under the same --experimental-vm-modules flag as
  // otplib. A test that needs a deterministic id mocks "uuid" in its own file
  // (jest.mock("uuid", ...)); do not add a file named uuid.js to
  // <rootDir>/__mocks__/, which would mock it for every test again.
  // Pinned by src/tests/models/uuidDefaults.a116.test.js.
  moduleFileExtensions: ["js", "json"],
  testTimeout: 10000,
};
