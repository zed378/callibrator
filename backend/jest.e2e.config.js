/** @type {import('jest').Config} */
require("dotenv").config({ path: ".env" });

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/e2e/**/*.test.js"],
  testPathIgnorePatterns: [],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: false,
  transform: {},
  transformIgnorePatterns: ["/node_modules/"],
  moduleNameMapper: {
    "^uuid$": "<rootDir>/__mocks__/uuid.js",
    "^otplib$": "<rootDir>/__mocks__/otplib.js",
  },
  moduleFileExtensions: ["js", "json"],
  testTimeout: 30000,
};
