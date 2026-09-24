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
  // uuid is still mapped. Our code's use (`v4()` returning a string) matches
  // the mock's shape, but the mapping also replaces the uuid@8 that Sequelize
  // requires internally (v1 and v4 for UUIDV1/UUIDV4 defaults): every
  // Sequelize-generated UUIDV4 in a unit run is the same constant, and v1 is
  // undefined.
  moduleNameMapper: {
    "^uuid$": "<rootDir>/__mocks__/uuid.js",
  },
  moduleFileExtensions: ["js", "json"],
  testTimeout: 10000,
};
